import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccessGuard, AuthenticatedRequest } from '../../../auth/access.guard';
import { Capabilities } from '../../../auth/capabilities.decorator';
import { RolesGuard } from '../../../auth/roles.guard';
import { RateLimitService } from '../../../common/rate-limit.service';
import { GAME_PLATFORM, GamePlatform } from '../../platform/game-adapter.types';
import { GameGatewayBase } from '../../platform/game-gateway.base';
import { CLASSIC_CAPABILITY, ClassicAdapter } from './classic.adapter';
import { ExchangeLaunchDto, ClassicPlayDto } from './classic.dto';

/** The recovered client's gateway presents its session capability in this header. */
const SESSION_HEADER = 'x-book-classic-session';
/** ... and names each state-changing request with this one. */
const REQUEST_ID_HEADER = 'x-pilot-request-id';

/**
 * Lucky Lady's HTTP surface.
 *
 * The routes are the game's own; everything behind them - capability issue and
 * exchange, session binding, ownership, rate limits, the read/gameplay split,
 * the request identity - is the shared gateway base. Native error mapping
 * remains here, alongside this game's paths and DTOs.
 */
@Controller('casino/book-of-ra-classic')
export class ClassicController extends GameGatewayBase {
  constructor(
    adapter: ClassicAdapter,
    @Inject(GAME_PLATFORM) platform: GamePlatform,
    limits: RateLimitService,
  ) {
    super(adapter, platform.capabilities, limits, {
      sessionHeader: SESSION_HEADER,
      requestIdHeader: REQUEST_ID_HEADER,
      scope: CLASSIC_CAPABILITY.scope,
      launchTtlMs: CLASSIC_CAPABILITY.launchTtlMs,
      sessionTtlMs: CLASSIC_CAPABILITY.sessionTtlMs,
      gamePath: CLASSIC_CAPABILITY.gamePath,
    });
  }

  /** Authenticated platform route: a player mints a one-time launch capability. */
  @Post('launch')
  @UseGuards(AccessGuard, RolesGuard)
  @Capabilities('GAME_PLAY')
  launch(@Req() request: AuthenticatedRequest) {
    return this.issueLaunch(request);
  }

  /** Called by the game origin; authenticated by the opaque launch capability. */
  @Post('launch/exchange')
  @HttpCode(HttpStatus.OK)
  exchange(@Body() body: ExchangeLaunchDto, @Req() request: Request) {
    return this.exchangeLaunch(body, request);
  }

  /** The whole native protocol: reads, gameplay and presentation receipts. */
  @Post('session/gameplay')
  @HttpCode(HttpStatus.OK)
  play(@Body() body: ClassicPlayDto, @Req() request: Request) {
    return this.gameplay(body, request);
  }
  /** Presents failures in the recovered client's own protocol shape. */
  protected asProtocolError(error: unknown) {
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
