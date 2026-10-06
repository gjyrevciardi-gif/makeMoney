import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';

type DbClient = Prisma.TransactionClient | PrismaService;
export type TokenPair = { accessToken: string; refreshToken: string; familyId: string };

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}
  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
  private async createPair(db: DbClient, userId: string, role: Role, familyId: string = randomUUID()): Promise<TokenPair> {
    const refreshToken = randomBytes(48).toString('base64url');
    await db.refreshToken.create({ data: { userId, familyId, tokenHash: this.hashToken(refreshToken), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
    return { accessToken: await this.jwt.signAsync({ sub: userId, role }, { expiresIn: '15m' }), refreshToken, familyId };
  }
  issueTokenPair(userId: string, role: Role, familyId?: string) { return this.createPair(this.prisma, userId, role, familyId); }

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

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized }, include: { wallet: true } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      await this.prisma.auditLog.create({ data: { targetType: 'LOGIN', action: 'LOGIN_FAILED', result: 'INVALID_CREDENTIALS', metadata: { email: normalized } } });
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    // Checked after the password so account state is never disclosed to someone
    // who does not hold the credentials. A disabled account gets no new session.
    if (user.disabled) {
      await this.prisma.auditLog.create({ data: { actorId: user.id, targetType: 'LOGIN', action: 'LOGIN_FAILED', result: 'ACCOUNT_DISABLED' } });
      throw new ForbiddenException('ACCOUNT_DISABLED');
    }
    const pair = await this.prisma.$transaction(async (tx) => {
      const issued = await this.createPair(tx, user.id, user.role);
      await tx.auditLog.create({ data: { actorId: user.id, targetType: 'USER', targetId: user.id, action: 'LOGIN_SUCCESS', result: 'SUCCESS' } });
      return issued;
    });
    return { pair, user: { id: user.id, email: user.email, role: user.role, balance: (user.wallet?.balance ?? 0n).toString() } };
  }

  async rotateRefreshToken(rawToken: string): Promise<TokenPair> {
    if (!rawToken) throw new UnauthorizedException('REFRESH_TOKEN_REQUIRED');
    const outcome = await this.prisma.$transaction(async (tx) => {
      const record = await tx.refreshToken.findUnique({ where: { tokenHash: this.hashToken(rawToken) }, include: { user: true } });
      if (!record) return { kind: 'invalid' as const };
      if (record.revokedAt) {
        await tx.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: record.userId, targetType: 'TOKEN_FAMILY', targetId: record.familyId, action: 'REFRESH_REUSE_DETECTED', result: 'REVOKED' } });
        return { kind: 'reuse' as const };
      }
      if (record.expiresAt <= new Date()) return { kind: 'invalid' as const };
      if (record.user.disabled) {
        // Status comes from the database, never the token: revoke the whole family
        // so a re-enabled account must sign in again, and report it.
        await tx.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { actorId: record.userId, targetType: 'TOKEN_FAMILY', targetId: record.familyId, action: 'PERMISSION_DENIED', result: 'ACCOUNT_DISABLED' } });
        return { kind: 'disabled' as const };
      }
      await tx.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
      const pair = await this.createPair(tx, record.userId, record.user.role, record.familyId);
      await tx.auditLog.create({ data: { actorId: record.userId, targetType: 'TOKEN_FAMILY', targetId: record.familyId, action: 'REFRESH_SUCCESS', result: 'SUCCESS' } });
      return { kind: 'success' as const, pair };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (outcome.kind === 'reuse') throw new ForbiddenException('REFRESH_TOKEN_REUSE_DETECTED');
    if (outcome.kind === 'disabled') throw new ForbiddenException('ACCOUNT_DISABLED');
    if (outcome.kind !== 'success') throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    return outcome.pair;
  }

  async revokeFamily(rawToken?: string): Promise<void> {
    if (!rawToken) return;
    await this.prisma.$transaction(async (tx) => {
      const record = await tx.refreshToken.findUnique({ where: { tokenHash: this.hashToken(rawToken) } });
      if (!record) return;
      await tx.refreshToken.updateMany({ where: { familyId: record.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: record.userId, targetType: 'TOKEN_FAMILY', targetId: record.familyId, action: 'LOGOUT', result: 'SUCCESS' } });
    });
  }
}
