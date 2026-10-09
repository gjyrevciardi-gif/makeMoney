import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { Capabilities } from '../auth/capabilities.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { BetsService } from './bets.service';
import { PlaceBetDto } from './place-bet.dto';
@Controller('bets') @UseGuards(AccessGuard, RolesGuard) @Capabilities('SELF_SERVICE')
export class BetsController {
  constructor(private readonly bets: BetsService, private readonly limiter: RateLimitService) {}
  @Post() async place(@Req() request: AuthenticatedRequest, @Body() body: PlaceBetDto) { await this.limiter.consume('bet', request.actor.id, RATE_LIMITS.bet); return this.bets.place(request.actor.id, body); }
}
