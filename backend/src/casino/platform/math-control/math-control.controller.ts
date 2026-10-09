import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../../../auth/access.guard';
import { Capabilities } from '../../../auth/capabilities.decorator';
import { RolesGuard } from '../../../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../../../common/rate-limit.service';
import { ActivateMathDto, MathPolicyDto, ValidationOptionsDto } from './math-control.dto';
import { MathControlService } from './math-control.service';
import { MathControlJobs } from './math-control.jobs';

class GameParams {
  @IsString() @MaxLength(64) gameId!: string;
}

class ProfileParams {
  @IsString() @MaxLength(64) gameId!: string;
  @IsString() @MaxLength(120) profileId!: string;
}

class ValidationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1_000) @Max(200_000) monteCarloRounds?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(2_000) bankrollSessions?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(200_000) bankrollHorizonPaidSpins?: number;
}

/**
 * Administrator surface for Game Math Control.
 *
 * ADMIN-only and additive: it can create mathematics, validate it and point a
 * game at it, and it can do nothing else. There is no route that chooses an
 * outcome, edits a settled round, or lets a client suggest a profile id, a
 * hash or a validation result.
 */
@Controller('admin/casino/math')
@UseGuards(AccessGuard, RolesGuard)
@Capabilities('GAME_MATH_MANAGE')
export class MathControlController {
  constructor(
    private readonly math: MathControlService,
    private readonly jobs: MathControlJobs,
    private readonly limits: RateLimitService,
  ) {}

  private throttle(actorId: string) {
    return this.limits.consume('admin:math', actorId, RATE_LIMITS.admin);
  }

  @Get()
  async overview(@Req() request: AuthenticatedRequest) {
    await this.throttle(request.actor.id);
    return this.math.overview(request.actor.id);
  }

  /** Observability for the bounded job runner: what ran, where, and how it ended. */
  @Get('jobs/:jobId')
  async job(@Req() request: AuthenticatedRequest, @Param('jobId') jobId: string) {
    await this.throttle(request.actor.id);
    return this.jobs.status(jobId);
  }

  @Get('jobs')
  async jobList(@Req() request: AuthenticatedRequest, @Query('gameId') gameId?: string) {
    await this.throttle(request.actor.id);
    return { jobs: this.jobs.list(gameId) };
  }

  @Get(':gameId')
  async profiles(@Req() request: AuthenticatedRequest, @Param() params: GameParams) {
    await this.throttle(request.actor.id);
    const [profiles, capabilities] = await Promise.all([
      this.math.listProfiles(request.actor.id, params.gameId),
      this.math.capabilities(request.actor.id, params.gameId),
    ]);
    return { ...profiles, capabilities };
  }

  @Get(':gameId/profiles/:profileId')
  async detail(@Req() request: AuthenticatedRequest, @Param() params: ProfileParams) {
    await this.throttle(request.actor.id);
    return this.math.profileDetail(request.actor.id, params.gameId, params.profileId);
  }

  /** Generate a candidate. Nothing becomes live here. */
  @Post(':gameId/generate')
  async generate(
    @Req() request: AuthenticatedRequest,
    @Param() params: GameParams,
    @Body() body: MathPolicyDto,
  ) {
    await this.throttle(request.actor.id);
    return this.math.generate(request.actor.id, params.gameId, body as unknown as Record<string, unknown>);
  }

  /** Server-produced validation evidence. The client cannot supply a result. */
  @Post(':gameId/profiles/:profileId/validate')
  async validate(
    @Req() request: AuthenticatedRequest,
    @Param() params: ProfileParams,
    @Query() query: ValidationQuery,
  ) {
    await this.throttle(request.actor.id);
    const options: ValidationOptionsDto = {
      monteCarloRounds: query.monteCarloRounds,
      bankrollSessions: query.bankrollSessions,
      bankrollHorizonPaidSpins: query.bankrollHorizonPaidSpins,
    };
    const evidence = await this.math.validate(request.actor.id, params.gameId, params.profileId, {
      monteCarloRounds: options.monteCarloRounds,
      bankrollSessions: options.bankrollSessions,
      sessionConfig: options.bankrollHorizonPaidSpins === undefined
        ? undefined
        : { ...defaultSessionConfigForHorizon(options.bankrollHorizonPaidSpins) },
    });
    return evidence;
  }

  @Post(':gameId/profiles/:profileId/activate')
  async activate(
    @Req() request: AuthenticatedRequest,
    @Param() params: ProfileParams,
    @Body() body: ActivateMathDto,
  ) {
    await this.throttle(request.actor.id);
    return this.math.activate(request.actor.id, params.gameId, params.profileId, body.expectedVersion);
  }
}

/** Horizon override keeps the checkpoint ladder inside the requested horizon. */
function defaultSessionConfigForHorizon(horizon: number) {
  const checkpoints = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000];
  const inHorizon = checkpoints.filter((value) => value <= horizon);
  return {
    startUnits: 10_000,
    stakeUnits: 20,
    horizonPaidSpins: horizon,
    aliveCheckpoints: inHorizon.length > 0 ? inHorizon : [horizon],
    balanceCheckpoints: [100, 250, 500, 1000, 5000].filter((value) => value <= horizon),
    reachTargets: [12_500, 15_000, 20_000],
    fallTargets: [8_000, 6_000, 4_000, 2_000],
    ruinCheckpoints: [100, 250, 500, 1000, 5000].filter((value) => value <= horizon),
  };
}
