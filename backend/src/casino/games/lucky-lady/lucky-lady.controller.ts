import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { AccessGuard, AuthenticatedRequest } from '../../../auth/access.guard';
import { Roles } from '../../../auth/roles.decorator';
import { RolesGuard } from '../../../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../../../common/rate-limit.service';
import { ExchangeLaunchDto, LuckyLadyPlayDto } from './lucky-lady.dto';
import { LuckyLadyGameService } from './lucky-lady.service';

const SESSION_HEADER = 'x-lucky-session';

/**
 * Platform side of the imported game's gateway.
 *
 * Two different trust relationships meet here:
 *
 *  - `launch` is a normal authenticated platform route. It is USER-only and
 *    re-reads the database role, so an administrator's valid token cannot open
 *    a player session.
 *  - everything else is called by the loopback game gateway with an opaque,
 *    hashed, expiring game capability. No platform JWT, refresh token or
 *    cookie is ever accepted or produced on these routes, so the recovered
 *    third-party client never shares an origin or a credential with the
 *    platform application.
 */
@Controller('casino/lucky-lady')
export class LuckyLadyController {
  constructor(
    private readonly game: LuckyLadyGameService,
    private readonly limits: RateLimitService,
  ) {}

  @Post('launch')
  @UseGuards(AccessGuard, RolesGuard)
  @Roles(Role.USER)
  async launch(@Req() request: AuthenticatedRequest) {
    await this.limits.consume('casino-lucky-launch', request.actor.id, RATE_LIMITS.luckyLadyLaunch);
    return this.game.issueLaunch(request.actor.id);
  }

  /** Called by the loopback gateway; authenticated by the opaque launch token. */
  @Post('launch/exchange')
  @HttpCode(HttpStatus.OK)
  async exchange(@Body() body: ExchangeLaunchDto, @Req() request: Request) {
    const subject = request.ip ?? 'unknown';
    await this.limits.consume('casino-lucky-exchange', subject, RATE_LIMITS.luckyLadyExchange);
    const session = await this.game.exchangeLaunch(body.token);
    return { sessionToken: session.sessionToken, sessionId: session.sessionId };
  }

  /**
   * The whole native protocol: reads, gameplay, presentation receipts.
   *
   * The game capability is read from a header the gateway attaches, never from
   * a cookie the browser could be tricked into sending to the platform, and
   * every response is wrapped in the protocol's own error shape so the
   * recovered client keeps its existing behaviour.
   */
  @Post('session/gameplay')
  @HttpCode(HttpStatus.OK)
  async gameplay(
    @Body() body: LuckyLadyPlayDto,
    @Req() request: Request & { headers: Record<string, string | string[] | undefined> },
  ) {
    const rawSession = this.header(request, SESSION_HEADER);
    if (!rawSession) throw new UnauthorizedException({ code: 'GAME_SESSION_REQUIRED', message: 'Game session required.' });
    const session = await this.game.assertSession(rawSession);
    const event = String(body.slotEvent);
    const payload = body as unknown as Record<string, unknown>;
    try {
      if (event === 'getSettings' || event === 'update' || event === 'ack') {
        await this.limits.consume('casino-lucky-read', session.userId, RATE_LIMITS.luckyLadyRead);
      }
      if (event === 'getSettings') return await this.game.settings(session.userId);
      if (event === 'update') return await this.game.update(session.userId);
      if (event === 'ack') return await this.game.acknowledge(session.userId, payload);

      await this.limits.consume('casino', session.userId, RATE_LIMITS.casino);
      const requestId = this.requestId(request);
      return await this.game.handleGameplay(
        session,
        event,
        payload,
        {
          'x-pilot-version': this.header(request, 'x-pilot-version'),
          'x-pilot-round': this.header(request, 'x-pilot-round'),
        },
        requestId,
      );
    } catch (error) {
      throw this.asProtocolError(error);
    }
  }

  private header(request: Request, name: string) {
    const value = request.headers[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : undefined;
  }

  /** Every state change must name itself so a retry can be recognised. */
  private requestId(request: Request) {
    const provided = this.header(request, 'x-pilot-request-id');
    if (provided && /^[a-zA-Z0-9_-]{8,80}$/.test(provided)) return provided;
    throw new HttpException(
      { responseEvent: 'error', reason: 'request id required' },
      HttpStatus.BAD_REQUEST,
    );
  }

  /** Presents failures in the recovered client's own protocol shape. */
  private asProtocolError(error: unknown) {
    if (error instanceof HttpException) {
      const status = error.getStatus();
      const response = error.getResponse();
      const record = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};
      const reason = typeof record.message === 'string'
        ? record.message
        : typeof response === 'string' ? response : 'request rejected';
      const code = typeof record.code === 'string' ? record.code : undefined;
      return new HttpException({ responseEvent: 'error', reason, ...(code ? { code } : {}) }, status);
    }
    return error;
  }
}
