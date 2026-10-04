import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedRequest } from '../../auth/access.guard';
import { RATE_LIMITS, RateLimitService } from '../../common/rate-limit.service';
import { GameAdapter, GameCapabilityPort } from './game-adapter.types';

/** Transport and lifetime choices a game makes about its own gateway. */
export type GameGatewayOptions = {
  /** Header the game origin uses to present its session capability. */
  sessionHeader: string;
  /**
   * Header carrying the request identity for state-changing calls.
   *
   * The name is the game's own protocol choice, so the shared layer never
   * hard-codes a recovered client's header.
   */
  requestIdHeader: string;
  /** Capability scope: the game and the single action it authorizes. */
  scope: string;
  launchTtlMs: number;
  sessionTtlMs: number;
  /** Static prefix of the recovered client on the game origin. */
  gamePath: string;
};

/**
 * The reusable HTTP surface of an integrated game.
 *
 * Three routes, identical for every adapter:
 *
 *   POST <base>/launch            authenticated player mints a one-time capability
 *   POST <base>/launch/exchange   the game origin trades it for a bound session
 *   POST <base>/session/gameplay  the game protocol, authenticated by that session
 *
 * The base class owns the platform's side of that contract: guard wiring lives
 * in the (tiny) per-game subclass, while rate limiting, capability verification,
 * the request identity and the read/gameplay split live here. Each game
 * controller owns its protocol's error shape.
 */
export abstract class GameGatewayBase {
  private readonly options: GameGatewayOptions;

  constructor(
    protected readonly adapter: GameAdapter,
    protected readonly capabilities: GameCapabilityPort,
    protected readonly limits: RateLimitService,
    options: Partial<GameGatewayOptions> = {},
  ) {
    this.options = {
      sessionHeader: options.sessionHeader ?? 'x-game-session',
      requestIdHeader: options.requestIdHeader ?? 'x-request-id',
      scope: options.scope ?? `game:${adapter.gameId}:play`,
      launchTtlMs: options.launchTtlMs ?? 60_000,
      sessionTtlMs: options.sessionTtlMs ?? 12 * 60 * 60 * 1000,
      gamePath: options.gamePath ?? '',
    };
  }

  /** Called by the per-game controller for its authenticated `launch` route. */
  protected async issueLaunch(request: AuthenticatedRequest) {
    await this.limits.consume('casino-game-launch', request.actor.id, RATE_LIMITS.gameLaunch);
    return this.capabilities.issueLaunch(request.actor.id, {
      gameId: this.adapter.gameId,
      scope: this.options.scope,
      ttlMs: this.options.launchTtlMs,
      gamePath: this.options.gamePath,
    });
  }

  /** Called by the game origin; authenticated by the opaque launch capability. */
  protected async exchangeLaunch(body: { token?: unknown }, request: Request) {
    const subject = request.ip ?? 'unknown';
    await this.limits.consume('casino-game-exchange', subject, RATE_LIMITS.gameExchange);
    const session = await this.capabilities.exchangeLaunch(String(body?.token ?? ''), {
      gameId: this.adapter.gameId,
      scope: this.options.scope,
      sessionTtlMs: this.options.sessionTtlMs,
    });
    return { sessionToken: session.sessionToken, sessionId: session.sessionId };
  }

  /** The whole native protocol: reads, gameplay and presentation receipts. */
  protected async gameplay(input: object, request: Request) {
    const body = input as Record<string, unknown>;
    const rawSession = this.header(request, this.options.sessionHeader);
    if (!rawSession) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_REQUIRED', message: 'Game session required.' });
    }
    try {
      const identity = await this.capabilities.assertSession(rawSession, this.adapter.gameId);
      const context = { gameId: this.adapter.gameId, userId: identity.userId, sessionId: identity.sessionId };
      const event = this.adapter.validateRequest(body);
      if (this.adapter.readOnlyEvents.includes(event)) {
        await this.limits.consume('casino-game-read', identity.userId, RATE_LIMITS.gameRead);
        return await this.adapter.read(context, event, body);
      }
      await this.limits.consume('casino', identity.userId, RATE_LIMITS.casino);
      return await this.adapter.execute(context, {
        event,
        body,
        // The adapter owns its own protocol, so it receives the request's own
        // headers and reads whichever of them its client defined.
        headers: normalizeHeaders(request),
        requestId: this.requestId(request),
      });
    } catch (error) {
      throw this.asProtocolError(error);
    }
  }

  protected header(request: Request, name: string) {
    const value = request.headers[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : undefined;
  }

  /** Every state change must name itself so a retry can be recognised. */
  protected requestId(request: Request) {
    const provided = this.header(request, this.options.requestIdHeader);
    if (provided && /^[a-zA-Z0-9_-]{8,80}$/.test(provided)) return provided;
    throw new HttpException(
      { message: 'request rejected' },
      HttpStatus.BAD_REQUEST,
    );
  }

  /** Game controllers may adapt errors to their own wire protocol. */
  protected asProtocolError(error: unknown) {
    return error;
  }

}

/** Lower-cased request headers, first value wins; the adapter reads its own. */
function normalizeHeaders(request: Request) {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}
