import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { hasCapability } from '../../auth/capabilities';
import {
  ExchangeOptions,
  GAME_AVAILABILITY,
  GAME_PLAYABILITY,
  GameActionGuardPort,
  GameAvailability,
  GamePlayability,
  GameSessionGrant,
  LaunchProof,
  LaunchGrant,
  LaunchOptions,
  OriginVerdict,
  SessionTrust,
  SessionIdentity,
  TransactionClient,
} from './game-adapter.types';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DEFAULT_LAUNCH_PATH = '/launch';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const opaqueToken = () => randomBytes(32).toString('base64url');

/**
 * Launch and session capabilities, shared by every integrated game.
 *
 * Two opaque capabilities, both stored only as a SHA-256 hash:
 *
 *  - a one-time launch capability, issued to an authenticated player by the
 *    platform and consumed exactly once by the game origin;
 *  - a reconnectable game session, bound to one user and one game, which the
 *    game origin presents as a header on every gameplay call.
 *
 * Neither is a platform credential: the browser never receives a platform JWT,
 * refresh cookie or user id, and the acting player is always re-derived from
 * the stored capability and re-checked against the database on every call.
 *
 * Both capabilities are additionally bound to the `User.authVersion` they were
 * minted under, and every read of the account they belong to happens under the
 * account row lock the auth flows take for logout, password change and disable.
 * A revocation therefore either linearizes before the capability is minted (and
 * the stale proof is refused) or after it is used; it can never be raced into a
 * fresh, usable credential.
 */
@Injectable()
export class GameCapabilityService implements GameActionGuardPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GAME_AVAILABILITY) private readonly availability: GameAvailability,
    @Inject(GAME_PLAYABILITY) private readonly playability: GamePlayability,
  ) {}

  /** Re-reads the database role and status: a demoted or disabled account must not play. */
  async requirePlayer(userId: string, gameId: string): Promise<PlayerRow> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PLAYER_COLUMNS,
    });
    if (!user) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' });
    }
    await this.assertMayPlay(user, gameId, true);
    return user;
  }

  /**
   * Issues one single-use launch capability. Neither the response nor the
   * database ever carries the raw secret twice, and only its hash is stored.
   *
   * The capability is stamped with the version the caller's access token was
   * verified under, and that version is re-checked while the account row is
   * locked: a logout or password change that committed first has already moved
   * it, so the stale proof is refused instead of minting a fresh capability.
   */
  async issueLaunch(actorId: string, options: LaunchOptions, proof: LaunchProof): Promise<LaunchGrant> {
    const { gameId, scope, ttlMs } = options;
    // Fast-path authorization outside the transaction, so a refusal is audited
    // even though the refusal itself writes nothing.
    await this.requirePlayer(actorId, gameId);
    this.availability.assertEnabled(gameId);
    await this.playability.assertPlayable(gameId);

    const token = opaqueToken();
    const expiresAt = new Date(Date.now() + ttlMs);
    const launch = await this.prisma.$transaction(async (tx) => {
      const user = await this.lockPlayerIn(tx, actorId, gameId);
      this.assertFreshProof(user, proof);
      return tx.gameLaunchCapability.create({
        data: { userId: actorId, scope, tokenHash: sha256(token), expiresAt, authVersion: user.authVersion },
      });
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_GAME',
        targetId: gameId,
        action: 'CASINO_ROUND_STARTED',
        result: 'LAUNCH_ISSUED',
        metadata: { scope, launchId: launch.id, expiresAt: expiresAt.toISOString() },
      },
    });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      path: options.path ?? DEFAULT_LAUNCH_PATH,
      gamePath: options.gamePath ?? '',
    };
  }

  /**
   * Exchanges a launch capability exactly once for a session bound to the
   * issuing user and game.
   *
   * All of the state that decides the exchange - the account row, the ticket's
   * expiry, its consumption and the version it was bound to - is read after the
   * account lock, and the consumption and the session mint commit together.
   * Two simultaneous exchanges therefore cannot both mint a session, and a
   * revocation that committed first is seen instead of being raced past.
   */
  async exchangeLaunch(rawToken: string, options: ExchangeOptions): Promise<GameSessionGrant> {
    const { gameId, scope, sessionTtlMs } = options;
    if (!isOpaqueToken(rawToken)) {
      throw new BadRequestException({ code: 'INVALID_LAUNCH_TOKEN', message: 'Invalid launch token.' });
    }
    const tokenHash = sha256(rawToken);
    const candidate = await this.prisma.gameLaunchCapability.findUnique({ where: { tokenHash } });
    if (!candidate || candidate.scope !== scope) {
      throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_INVALID', message: 'That launch link is not valid.' });
    }
    // Authorization and its denial audit happen outside the transaction; the
    // transaction below re-checks everything authoritative under the lock.
    await this.requirePlayer(candidate.userId, gameId);
    this.availability.assertEnabled(gameId);
    await this.playability.assertPlayable(gameId);

    return this.prisma.$transaction(async (tx) => {
      const user = await this.lockPlayerIn(tx, candidate.userId, gameId);
      const launch = await tx.gameLaunchCapability.findUnique({ where: { id: candidate.id } });
      if (!launch || launch.scope !== scope) {
        throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_INVALID', message: 'That launch link is not valid.' });
      }
      if (launch.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_EXPIRED', message: 'That launch link has expired.' });
      }
      if (launch.consumedAt) {
        throw new ConflictException({ code: 'LAUNCH_TOKEN_USED', message: 'That launch link has already been used.' });
      }
      if (launch.authVersion === null || launch.authVersion !== user.authVersion) {
        throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_INVALID', message: 'That launch link is not valid.' });
      }
      const consumed = await tx.gameLaunchCapability.updateMany({
        where: { id: launch.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new ConflictException({ code: 'LAUNCH_TOKEN_USED', message: 'That launch link has already been used.' });
      }
      const sessionToken = opaqueToken();
      const session = await tx.gameSession.create({
        data: {
          userId: user.id,
          gameId,
          tokenHash: sha256(sessionToken),
          expiresAt: new Date(Date.now() + sessionTtlMs),
          authVersion: user.authVersion,
        },
      });
      await tx.gameLaunchCapability.update({ where: { id: launch.id }, data: { sessionId: session.id } });
      return { userId: user.id, sessionId: session.id, sessionToken };
    });
  }

  /** Validates a gameplay capability and re-checks authorization on every call. */
  async assertSession(rawToken: string, gameId: string): Promise<SessionIdentity> {
    if (!isOpaqueToken(rawToken)) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_INVALID', message: 'Game session required.' });
    }
    const session = await this.prisma.gameSession.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!session || session.gameId !== gameId || session.revokedAt) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_INVALID', message: 'Game session required.' });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_EXPIRED', message: 'Your game session expired.' });
    }
    const user = await this.requirePlayer(session.userId, gameId);
    // A session minted before a logout / password change / disable carries an
    // older version (or none at all) and is refused before it can be presented.
    if (session.authVersion === null || session.authVersion !== user.authVersion) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_INVALID', message: 'Game session required.' });
    }
    this.availability.assertEnabled(gameId);
    await this.playability.assertPlayable(gameId);
    await this.prisma.gameSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return { userId: session.userId, sessionId: session.id };
  }

  /**
   * The authoritative check every gameplay transaction runs.
   *
   * Called by the journal after the per-player game lock and before any wallet
   * row is locked. The account row is locked first - the very same lock the auth
   * flows take for logout, password change and disable - so one gameplay action
   * and one revocation can never interleave: whichever takes the row lock first
   * commits first, and the loser re-reads committed state. Because the session
   * row, the account status and the account version are all read after the lock,
   * an HTTP-only check cannot be raced into a settlement.
   */
  async assertActionAllowed(
    tx: TransactionClient,
    action: { gameId: string; userId: string; trust: SessionTrust },
  ): Promise<void> {
    const verdict = await this.originStateIn(tx, {
      gameId: action.gameId,
      userId: action.userId,
      sessionId: action.trust.sessionId,
    });
    if (!verdict.usable) throw refusalFor(verdict.reason);
  }

  /**
   * The same authoritative verdict, reported instead of thrown.
   *
   * Used to decide whether a prepared outcome whose origin session was retired
   * can ever settle. It is deliberately the *same* lock and the *same* reads as
   * `assertActionAllowed` - account row first, then the session row - so a
   * cancellation decision cannot be taken from a lighter-weight or stale view,
   * and a cancelled key can never be declared cancelled while a valid origin
   * could still have settled it.
   */
  async originStateIn(
    tx: TransactionClient,
    origin: { gameId: string; userId: string; sessionId: string | null },
  ): Promise<OriginVerdict> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${origin.userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: origin.userId }, select: PLAYER_COLUMNS });
    if (!user) return { usable: false, reason: 'ACCOUNT_MISSING' };
    if (user.disabled) return { usable: false, reason: 'ACCOUNT_DISABLED' };
    if (!hasCapability(user.role, 'GAME_PLAY')) return { usable: false, reason: 'GAME_PLAY_REQUIRED' };
    if (origin.sessionId === null) return { usable: false, reason: 'SESSION_UNBOUND' };
    if (!UUID_PATTERN.test(origin.sessionId)) return { usable: false, reason: 'SESSION_INVALID' };
    const session = await tx.gameSession.findUnique({ where: { id: origin.sessionId } });
    if (!session || session.userId !== user.id || session.gameId !== origin.gameId) {
      return { usable: false, reason: 'SESSION_INVALID' };
    }
    if (session.revokedAt) return { usable: false, reason: 'SESSION_REVOKED' };
    if (session.expiresAt.getTime() <= Date.now()) return { usable: false, reason: 'SESSION_EXPIRED' };
    if (session.authVersion === null || session.authVersion !== user.authVersion) {
      return { usable: false, reason: 'SESSION_REVOKED' };
    }
    return { usable: true, reason: 'USABLE' };
  }

  /**
   * Lock the account row and re-read the player state inside it.
   *
   * Locking the account before anything else is the documented ordering of this
   * platform: the auth flows take this row first and the wallet row later, so a
   * gameplay transaction that follows the same order cannot deadlock with a
   * concurrent logout or with another game settling the same wallet.
   */
  private async lockPlayerIn(tx: TransactionClient, userId: string, gameId: string): Promise<PlayerRow> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: PLAYER_COLUMNS });
    if (!user) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' });
    }
    // No audit row here: this runs inside the transaction that is about to be
    // rolled back, so the row would never be committed. The HTTP paths audit.
    await this.assertMayPlay(user, gameId, false);
    return user;
  }

  /**
   * GAME_PLAY is held by USER, ADMIN and SUPER_ADMIN alike, so any account with
   * the capability may open a game session - but the session and every round
   * stay bound to that one user, and a disabled account may never play.
   */
  private async assertMayPlay(user: PlayerRow, gameId: string, audit: boolean) {
    if (!user.disabled && hasCapability(user.role, 'GAME_PLAY')) return;
    if (audit) {
      await this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          targetType: 'CASINO_GAME',
          targetId: gameId,
          action: 'PERMISSION_DENIED',
          result: 'DENIED',
          metadata: { operation: 'GAME_PLAY_REQUIRED', disabled: user.disabled },
        },
      });
    }
    throw new ForbiddenException({ code: 'GAME_PLAY_REQUIRED', message: 'This account may not play games.' });
  }

  /** The verified token proof must still match the account it was minted for. */
  private assertFreshProof(user: PlayerRow, proof: LaunchProof) {
    const claim = proof?.authVersion;
    if (
      typeof claim !== 'number'
      || !Number.isSafeInteger(claim)
      || claim < 0
      || claim !== user.authVersion
    ) {
      throw new UnauthorizedException({ code: 'SESSION_PROOF_STALE', message: 'The sign-in is no longer valid.' });
    }
  }
}

type PlayerRow = { id: string; role: Role; disabled: boolean; authVersion: number };

const PLAYER_COLUMNS = { id: true, role: true, disabled: true, authVersion: true } as const;

/** The refusal an unusable origin produces on a gameplay path. */
function refusalFor(reason: OriginVerdict['reason']) {
  if (reason === 'ACCOUNT_DISABLED' || reason === 'GAME_PLAY_REQUIRED') {
    return new ForbiddenException({ code: 'GAME_PLAY_REQUIRED', message: 'This account may not play games.' });
  }
  if (reason === 'SESSION_EXPIRED') {
    return new UnauthorizedException({ code: 'GAME_SESSION_EXPIRED', message: 'Your game session expired.' });
  }
  return new UnauthorizedException({ code: 'GAME_SESSION_INVALID', message: 'Game session required.' });
}

function isOpaqueToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 200 && !CONTROL_CHARS.test(value);
}
