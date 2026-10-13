import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { revokeGameCredentials } from './game-session-revocation';

type DbClient = Prisma.TransactionClient | PrismaService;
export type TokenPair = { accessToken: string; refreshToken: string; familyId: string };

/**
 * JWT claim carrying the `User.authVersion` a token was minted under. The guard
 * compares it to the database value, so bumping the column retires every token
 * issued before the bump without any timestamp comparison.
 */
export const AUTH_VERSION_CLAIM = 'av';

/**
 * The result of the credential (or MFA challenge) step that justifies issuing a
 * session. `authVersion` is always carried; `passwordHash` is added when the
 * proof came from an actual password check, so the same proof cannot outlive a
 * concurrent reset of that password.
 */
export type SessionProof = { authVersion: number; passwordHash?: string };

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}
  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
  /**
   * Serialize every operation that rotates or revokes a user's sessions on the
   * user row. The loser of the race blocks here and then re-reads state, so a
   * logout that commits first can never be raced into minting a fresh session.
   */
  private async lockUser(tx: Prisma.TransactionClient, userId: string) { await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`; }
  private async createPair(db: DbClient, userId: string, role: Role, authVersion: number, familyId: string = randomUUID()): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');
    await db.refreshToken.create({ data: { userId, familyId, tokenHash: this.hashToken(refreshToken), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    return { accessToken: await this.jwt.signAsync({ sub: userId, role, [AUTH_VERSION_CLAIM]: authVersion }, { expiresIn: '15m' }), refreshToken, familyId };
  }
  /**
   * Re-check the proof while the account row is locked. A password change or
   * logout that committed first has already moved the version (and possibly the
   * hash), so the stale proof fails closed instead of minting a live session.
   */
  private assertSessionProof(fresh: { disabled: boolean; authVersion: number; passwordHash: string }, proof: SessionProof) {
    if (fresh.disabled) throw new ForbiddenException('ACCOUNT_DISABLED');
    const passwordMatches = proof.passwordHash === undefined || proof.passwordHash === fresh.passwordHash;
    if (fresh.authVersion !== proof.authVersion || !passwordMatches) {
      throw new UnauthorizedException({ code: 'SESSION_PROOF_STALE', message: 'The sign-in is no longer valid.' });
    }
  }
  async issueTokenPair(userId: string, role: Role, familyId?: string) {
    // Minting a refresh token is itself a session-creating act: take the same
    // account lock, so the version and the new row cannot be raced apart and no
    // usable successor can escape a concurrent logout or a disabled account.
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const user = await tx.user.findUnique({ where: { id: userId }, select: { disabled: true, authVersion: true } });
      if (!user) throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
      if (user.disabled) throw new ForbiddenException('ACCOUNT_DISABLED');
      return this.createPair(tx, userId, role, user.authVersion, familyId);
    });
  }

  async register(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: normalized, passwordHash } });
        const wallet = await tx.wallet.create({ data: { userId: user.id } });
        await tx.auditLog.create({ data: { actorId: user.id, targetType: 'USER', targetId: user.id, action: 'REGISTER', result: 'SUCCESS' } });
        return { id: user.id, email: user.email, role: user.role, balance: wallet.balance.toString() };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('ACCOUNT_ALREADY_EXISTS');
      throw error;
    }
  }

  /** `identifier` is a username or an email address (both stored lowercase). */
  /** Password check only. Callers that support a second factor decide what happens next. */
  async verifyCredentials(identifier: string, password: string) {
    const normalized = identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { OR: [{ username: normalized }, { email: normalized }] }, include: { wallet: true } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      await this.prisma.auditLog.create({ data: { targetType: 'LOGIN', action: 'LOGIN_FAILED', result: 'INVALID_CREDENTIALS', metadata: { identifier: normalized } } });
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    // Checked after the password so account state is never disclosed to someone
    // who does not hold the credentials. A disabled account gets no new session.
    if (user.disabled) {
      await this.prisma.auditLog.create({ data: { actorId: user.id, targetType: 'LOGIN', action: 'LOGIN_FAILED', result: 'ACCOUNT_DISABLED' } });
      throw new ForbiddenException('ACCOUNT_DISABLED');
    }
    return user;
  }

  /**
   * Short-lived proof that the password step passed. It is not an access token
   * and the guard refuses it. It is bound to the auth version so a challenge
   * issued before a password change (or logout) cannot finish a fresh session.
   */
  issueMfaChallenge(userId: string, authVersion: number) { return this.jwt.signAsync({ sub: userId, typ: 'mfa', [AUTH_VERSION_CLAIM]: authVersion }, { expiresIn: '5m' }); }

  async readMfaChallenge(token: string): Promise<{ userId: string; authVersion: number }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string; av?: unknown }>(token);
      if (payload.typ !== 'mfa') throw new Error('not an MFA challenge');
      const version = payload.av;
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw new Error('challenge has no version');
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { authVersion: true } });
      if (!user || user.authVersion !== version) throw new Error('challenge is stale');
      // The version is returned as the proof the second step must re-check
      // under the issuance lock; the id alone would let a password change in
      // between restore a fresh session from an old challenge.
      return { userId: payload.sub, authVersion: version };
    } catch { /* fall through */ }
    throw new UnauthorizedException({ code: 'INVALID_MFA_CHALLENGE', message: 'The sign-in expired.' });
  }

  async login(identifier: string, password: string) {
    const user = await this.verifyCredentials(identifier, password);
    return this.startSession(user, { authVersion: user.authVersion, passwordHash: user.passwordHash });
  }

  async startSessionFor(userId: string, proof: SessionProof) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { wallet: true } });
    if (!user) throw new UnauthorizedException({ code: 'INVALID_MFA_CHALLENGE', message: 'The sign-in expired.' });
    if (user.disabled) throw new ForbiddenException('ACCOUNT_DISABLED');
    return this.startSession(user, proof);
  }

  private async startSession(user: Prisma.UserGetPayload<{ include: { wallet: true } }>, proof: SessionProof) {
    const pair = await this.prisma.$transaction(async (tx) => {
      // Re-read under the lock so a login that races a logout or a password
      // change either loses cleanly or is stamped with the version in force at
      // commit time; the proof from the password step must still match.
      await this.lockUser(tx, user.id);
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { role: true, disabled: true, authVersion: true, passwordHash: true } });
      this.assertSessionProof(fresh, proof);
      const issued = await this.createPair(tx, user.id, fresh.role, fresh.authVersion);
      await tx.auditLog.create({ data: { actorId: user.id, targetType: 'USER', targetId: user.id, action: 'LOGIN_SUCCESS', result: 'SUCCESS' } });
      return issued;
    });
    return { pair, user: { id: user.id, username: user.username, email: user.email, role: user.role, balance: (user.wallet?.balance ?? 0n).toString() } };
  }

  async rotateRefreshToken(rawToken: string): Promise<TokenPair> {
    if (!rawToken) throw new UnauthorizedException('REFRESH_TOKEN_REQUIRED');
    const outcome = await this.prisma.$transaction(async (tx) => {
      const record = await tx.refreshToken.findUnique({ where: { tokenHash: this.hashToken(rawToken) }, select: { id: true, userId: true } });
      if (!record) return { kind: 'invalid' as const };
      // Take the user lock, then re-read the token and the version *after* it.
      // A concurrent logout or password change that committed first has already
      // revoked this row (and bumped the version), so it cannot be rotated.
      await this.lockUser(tx, record.userId);
      const fresh = await tx.refreshToken.findUnique({ where: { id: record.id }, include: { user: true } });
      if (!fresh) return { kind: 'invalid' as const };
      if (fresh.revokedAt) {
        await tx.refreshToken.updateMany({ where: { familyId: fresh.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: fresh.userId, targetType: 'TOKEN_FAMILY', targetId: fresh.familyId, action: 'REFRESH_REUSE_DETECTED', result: 'REVOKED' } });
        return { kind: 'reuse' as const };
      }
      if (fresh.expiresAt <= new Date()) return { kind: 'invalid' as const };
      if (fresh.user.disabled) {
        // Status comes from the database, never the token: revoke the whole family
        // so a re-enabled account must sign in again, and report it.
        await tx.refreshToken.updateMany({ where: { familyId: fresh.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: fresh.userId, targetType: 'TOKEN_FAMILY', targetId: fresh.familyId, action: 'PERMISSION_DENIED', result: 'ACCOUNT_DISABLED' } });
        return { kind: 'disabled' as const };
      }
      await tx.refreshToken.update({ where: { id: fresh.id }, data: { revokedAt: new Date() } });
      const pair = await this.createPair(tx, fresh.userId, fresh.user.role, fresh.user.authVersion, fresh.familyId);
      await tx.auditLog.create({ data: { actorId: fresh.userId, targetType: 'TOKEN_FAMILY', targetId: fresh.familyId, action: 'REFRESH_SUCCESS', result: 'SUCCESS' } });
      return { kind: 'success' as const, pair };
    });
    if (outcome.kind === 'reuse') throw new ForbiddenException('REFRESH_TOKEN_REUSE_DETECTED');
    if (outcome.kind === 'disabled') throw new ForbiddenException('ACCOUNT_DISABLED');
    if (outcome.kind !== 'success') throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    return outcome.pair;
  }

  async revokeFamily(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    // The cookie identifies the account; an unknown or absent token must not
    // touch anyone. Sign-out is deliberately all-devices: bump the version so
    // every live access token dies, and revoke every refresh token for the
    // user — including one that a previous rotation already revoked.
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.refreshToken.findUnique({ where: { tokenHash: this.hashToken(rawToken) }, select: { userId: true } });
      if (!record) return;
      await this.lockUser(tx, record.userId);
      await tx.user.update({ where: { id: record.userId }, data: { authVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      // Gameplay is bound to the same version: the sign-out that just retired
      // every access token also retires every bound game session and every
      // pending launch capability that user holds, in this same commit.
      await revokeGameCredentials(tx, record.userId);
      await tx.auditLog.create({ data: { actorId: record.userId, targetType: 'USER', targetId: record.userId, action: 'LOGOUT', result: 'SUCCESS', metadata: { scope: 'ALL_DEVICES' } } });
    });
  }
}
