import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessGuard, AuthenticatedRequest } from '../../../auth/access.guard';
import { Roles } from '../../../auth/roles.decorator';
import { RolesGuard } from '../../../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../../../common/rate-limit.service';
import { BookOfRaActionDto, SpinBookOfRaDto } from './book-of-ra.dto';
import { BookOfRaService } from './book-of-ra.service';

/**
 * Player-facing Book of the Sands API.
 *
 * Every route resolves the acting user from the verified access token. No
 * endpoint accepts a user id, a board, an expanding symbol, a payout, a
 * multiplier or a line count, and the global whitelist validation pipe rejects
 * a request that tries to send any of them.
 */
@Controller('casino/book-of-ra')
@UseGuards(AccessGuard, RolesGuard)
@Roles(Role.USER, Role.ADMIN)
export class BookOfRaController {
  constructor(
    private readonly book: BookOfRaService,
    private readonly limits: RateLimitService,
  ) {}

  private async throttle(userId: string) {
    await this.limits.consume('casino', userId, RATE_LIMITS.casino);
  }

  /** Published rules, paytable, profile fingerprint and stake limits. */
  @Get('config')
  config() {
    return this.book.config();
  }

  /** Refresh projection: free games, locked stake and any pending gamble. */
  @Get('state')
  state(@Req() request: AuthenticatedRequest) {
    return this.book.state(request.actor.id);
  }

  @Post('spin')
  async spin(@Req() request: AuthenticatedRequest, @Body() body: SpinBookOfRaDto) {
    await this.throttle(request.actor.id);
    return this.book.spin(request.actor.id, body);
  }

  /** Resolves the round's pending action; a replayed key returns the same response. */
  @Post('action')
  async act(@Req() request: AuthenticatedRequest, @Body() body: BookOfRaActionDto) {
    await this.throttle(request.actor.id);
    return this.book.act(request.actor.id, body);
  }
}
