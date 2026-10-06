import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../../../../auth/access.guard';
import { Capabilities } from '../../../../auth/capabilities.decorator';
import { RolesGuard } from '../../../../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../../../../common/rate-limit.service';
import { PayoutActionDto, PayoutCandidateParams, PayoutGenerateDto } from './lucky-lady-payout.dto';
import { LuckyLadyPayoutService } from './lucky-lady-payout.service';

class HistoryQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

/**
 * Administrator surface for the Lucky Lady RTP Control panel.
 *
 * Gated by the GAME_MATH_MANAGE capability (held by ADMIN and SUPER_ADMIN, not USER)
 * and additive. Every route re-checks the database role inside the service; the actor is taken from the authenticated request and never from a
 * body. There is no route that chooses an outcome, edits a settled round, or
 * accepts a client-supplied report.
 */
@Controller('admin/casino/math/lucky-lady/payout')
@UseGuards(AccessGuard, RolesGuard)
@Capabilities('GAME_MATH_MANAGE')
export class LuckyLadyPayoutController {
  constructor(
    private readonly payout: LuckyLadyPayoutService,
    private readonly limits: RateLimitService,
  ) {}

  private throttle(actorId: string) {
    return this.limits.consume('admin:math:payout', actorId, RATE_LIMITS.admin);
  }

  @Get('current')
  async current(@Req() request: AuthenticatedRequest) {
    await this.throttle(request.actor.id);
    return this.payout.current(request.actor.id);
  }

  @Get('history')
  async history(@Req() request: AuthenticatedRequest, @Query() query: HistoryQuery) {
    await this.throttle(request.actor.id);
    return this.payout.history(request.actor.id, query.limit);
  }

  @Get('candidates')
  async candidates(@Req() request: AuthenticatedRequest) {
    await this.throttle(request.actor.id);
    return this.payout.candidates(request.actor.id);
  }

  /** Generate a bounded candidate and its server evidence. Nothing goes live. */
  @Post('generate')
  async generate(@Req() request: AuthenticatedRequest, @Body() body: PayoutGenerateDto) {
    await this.throttle(request.actor.id);
    return this.payout.generate(request.actor.id, body as unknown as Record<string, unknown>);
  }

  /** The stored evidence report for one candidate; the client cannot supply it. */
  @Get('candidates/:candidateId')
  async preview(@Req() request: AuthenticatedRequest, @Param() params: PayoutCandidateParams) {
    await this.throttle(request.actor.id);
    return this.payout.preview(request.actor.id, params.candidateId);
  }

  @Post('candidates/:candidateId/activate')
  async activate(
    @Req() request: AuthenticatedRequest,
    @Param() params: PayoutCandidateParams,
    @Body() body: PayoutActionDto,
  ) {
    await this.throttle(request.actor.id);
    return this.payout.activate(request.actor.id, params.candidateId, body);
  }

  @Post('rollback')
  async rollback(@Req() request: AuthenticatedRequest, @Body() body: PayoutActionDto) {
    await this.throttle(request.actor.id);
    return this.payout.rollback(request.actor.id, body);
  }

  @Post('default')
  async restoreDefault(@Req() request: AuthenticatedRequest, @Body() body: PayoutActionDto) {
    await this.throttle(request.actor.id);
    return this.payout.restoreDefault(request.actor.id, body);
  }
}
