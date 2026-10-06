import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { hasCapability } from '../../auth/capabilities';
import {
  ExchangeOptions,
  GAME_AVAILABILITY,
  GAME_PLAYABILITY,
  GameAvailability,
  GamePlayability,
  GameSessionGrant,
  LaunchGrant,
  LaunchOptions,
  SessionIdentity,
} from './game-adapter.types';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const DEFAULT_LAUNCH_PATH = '/launch';

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
 */
@Injectable()
export class GameCapabilityService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GAME_AVAILABILITY) private readonly availability: GameAvailability,
    @Inject(GAME_PLAYABILITY) private readonly playability: GamePlayability,
  ) {}

  /** Re-reads the database role and status: a demoted or disabled account must not play. */
  async requirePlayer(userId: string, gameId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, disabled: true },
    });
    if (!user) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' });
    }
    // GAME_PLAY is held by USER, ADMIN and SUPER_ADMIN alike, so any account
    // with the capability may open a game session - but the session and every
    // round stay bound to that one user.
    if (user.disabled || !hasCapability(user.role, 'GAME_PLAY')) {
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
      throw new ForbiddenException({ code: 'GAME_PLAY_REQUIRED', message: 'This account may not play games.' });
    }
    return user;
  }

  /**
   * Issues one single-use launch capability. Neither the response nor the
   * database ever carries the raw secret twice, and only its hash is stored.
   */
  async issueLaunch(actorId: string, options: LaunchOptions): Promise<LaunchGrant> {
    const { gameId, scope, ttlMs } = options;
    await this.requirePlayer(actorId, gameId);
    this.availability.assertEnabled(gameId);
    await this.playability.assertPlayable(gameId);

    const token = opaqueToken();
    const expiresAt = new Date(Date.now() + ttlMs);
    const launch = await this.prisma.gameLaunchCapability.create({
      data: { userId: actorId, scope, tokenHash: sha256(token), expiresAt },
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
   * Consumption is a conditional update, so two simultaneous exchanges cannot
   * both mint a session even without a lock.
   */
  async exchangeLaunch(rawToken: string, options: ExchangeOptions): Promise<GameSessionGrant> {
    const { gameId, scope, sessionTtlMs } = options;
    if (!isOpaqueToken(rawToken)) {
      throw new BadRequestException({ code: 'INVALID_LAUNCH_TOKEN', message: 'Invalid launch token.' });
    }
    const tokenHash = sha256(rawToken);
    const launch = await this.prisma.gameLaunchCapability.findUnique({ where: { tokenHash } });
    if (!launch || launch.scope !== scope) {
      throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_INVALID', message: 'That launch link is not valid.' });
    }
    if (launch.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_EXPIRED', message: 'That launch link has expired.' });
    }
    const consumed = await this.prisma.gameLaunchCapability.updateMany({
      where: { id: launch.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new ConflictException({ code: 'LAUNCH_TOKEN_USED', message: 'That launch link has already been used.' });
    }
    await this.requirePlayer(launch.userId, gameId);
    this.availability.assertEnabled(gameId);
    await this.playability.assertPlayable(gameId);

    const sessionToken = opaqueToken();
    const session = await this.prisma.gameSession.create({
      data: {
        userId: launch.userId,
        gameId,
        tokenHash: sha256(sessionToken),
        expiresAt: new Date(Date.now() + sessionTtlMs),
      },
    });
    await this.prisma.gameLaunchCapability.update({ where: { id: launch.id }, data: { sessionId: session.id } });
    return { userId: launch.userId, sessionId: session.id, sessionToken };
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
    await this.requirePlayer(session.userId, gameId);
    this.availability.assertEnabled(gameId);
    await this.playability.assertPlayable(gameId);
    await this.prisma.gameSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return { userId: session.userId, sessionId: session.id };
  }
}

function isOpaqueToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 200 && !CONTROL_CHARS.test(value);
}
