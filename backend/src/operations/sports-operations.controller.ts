import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { Capabilities } from '../auth/capabilities.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { SportsOperationsService } from './sports-operations.service';

class PageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

class EventParams {
  @Matches(/^[A-Za-z0-9_.-]{1,60}$/) provider!: string;
  @Matches(/^[A-Za-z0-9_.:-]{1,150}$/) providerEventId!: string;
}

/**
 * Administrator-only sportsbook operations. The route guards authenticate and
 * authorize, and every service method independently re-checks the persisted
 * ADMIN role, so authority cannot outlive a role change.
 */
@Controller('admin/sports')
@UseGuards(AccessGuard, RolesGuard)
@Capabilities('PLATFORM_MANAGE')
export class SportsOperationsController {
  constructor(
    private readonly operations: SportsOperationsService,
    private readonly limits: RateLimitService,
  ) {}

  @Get('providers/status')
  status(@Req() request: AuthenticatedRequest) {
    return this.operations.status(request.actor.id);
  }

  @Get('bets/stale')
  stale(@Req() request: AuthenticatedRequest, @Query() page: PageDto) {
    return this.operations.staleBets(request.actor.id, page.limit);
  }

  @Get('settlement/failures')
  failures(@Req() request: AuthenticatedRequest, @Query() page: PageDto) {
    return this.operations.settlementFailures(request.actor.id, page.limit);
  }

  @Get('conflicts')
  conflicts(@Req() request: AuthenticatedRequest, @Query() page: PageDto) {
    return this.operations.conflicts(request.actor.id, page.limit);
  }

  @Get('events/:provider/:providerEventId/reconciliation')
  reconciliation(@Req() request: AuthenticatedRequest, @Param() params: EventParams) {
    return this.operations.reconciliation(
      request.actor.id,
      params.provider,
      params.providerEventId,
    );
  }

  /**
   * Requests a fresh authoritative provider result. The administrator supplies
   * only the event identity; the winner, score, and payout remain provider and
   * settlement decisions.
   */
  @Post('events/:provider/:providerEventId/reconcile')
  async reconcile(@Req() request: AuthenticatedRequest, @Param() params: EventParams) {
    await this.limits.consume('admin:reconcile', request.actor.id, RATE_LIMITS.adminReconcile);
    return this.operations.reconcile(
      request.actor.id,
      params.provider,
      params.providerEventId,
    );
  }
}
