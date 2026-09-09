import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { CasinoConfigService } from './casino-config.service';

/**
 * Candidate configuration submitted by an administrator.
 *
 * The acting administrator is taken from the verified access token; the body
 * carries no identity at all. Global whitelist validation rejects the whole
 * request if it tries to supply `adminId`, `actorId`, `createdBy`, or `role`.
 */
class ConfigCandidateDto {
  @IsInt() @Min(1) @Max(1_000_000_000) minStake!: number;

  @IsInt() @Min(1) @Max(1_000_000_000) maxStake!: number;

  /** Null for games whose return is fixed by canonical or rule-based maths. */
  @IsOptional() @IsInt() @Min(0) @Max(10_000) rtpBps?: number;

  @IsOptional() @IsObject() gameSpecific?: Record<string, unknown>;

  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class ActivateVersionDto {
  /** Optimistic concurrency: the version the operator believed was live. */
  @IsOptional() @IsInt() @Min(1) expectedCurrentVersion?: number;
}

class GameStatusDto {
  @IsOptional() @IsBoolean() enabled?: boolean;

  @IsOptional() @IsBoolean() maintenance?: boolean;
}

class PlatformMaintenanceDto {
  @IsOptional() @IsBoolean() casinoMaintenance?: boolean;

  @IsOptional() @IsBoolean() sportsbookMaintenance?: boolean;
}

class VersionsQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
}

class VersionParams {
  @IsString() gameId!: string;

  @IsUUID() versionId!: string;
}

/**
 * The administrator control centre for casino configuration.
 *
 * Everything here changes *future* configuration. There is deliberately no
 * route that can choose a winning number, a card, a crash point, a reel stop,
 * or the outcome of any particular round, and none that edits a settled result.
 */
@Controller('admin/casino/config')
@UseGuards(AccessGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CasinoConfigController {
  constructor(
    private readonly configs: CasinoConfigService,
    private readonly limits: RateLimitService,
  ) {}

  private throttle(userId: string) {
    return this.limits.consume('admin:config', userId, RATE_LIMITS.admin);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.configs.listConfigs(request.actor.id);
  }

  @Get(':gameId')
  detail(@Req() request: AuthenticatedRequest, @Param('gameId') gameId: string) {
    return this.configs.gameConfig(request.actor.id, gameId);
  }

  @Get(':gameId/versions')
  versions(
    @Req() request: AuthenticatedRequest,
    @Param('gameId') gameId: string,
    @Query() query: VersionsQuery,
  ) {
    return this.configs.versions(request.actor.id, gameId, query.limit);
  }

  /** Validates a candidate without persisting anything. */
  @Post(':gameId/preview')
  async preview(
    @Req() request: AuthenticatedRequest,
    @Param('gameId') gameId: string,
    @Body() body: ConfigCandidateDto,
  ) {
    await this.throttle(request.actor.id);
    return this.configs.preview(request.actor.id, gameId, {
      minStake: BigInt(body.minStake),
      maxStake: BigInt(body.maxStake),
      rtpBps: body.rtpBps ?? null,
      gameSpecific: body.gameSpecific ?? {},
    });
  }

  /** Creates a DRAFT. A draft is inert until it is explicitly activated. */
  @Post(':gameId/versions')
  async createVersion(
    @Req() request: AuthenticatedRequest,
    @Param('gameId') gameId: string,
    @Body() body: ConfigCandidateDto,
  ) {
    await this.throttle(request.actor.id);
    return this.configs.createVersion(
      request.actor.id,
      gameId,
      {
        minStake: BigInt(body.minStake),
        maxStake: BigInt(body.maxStake),
        rtpBps: body.rtpBps ?? null,
        gameSpecific: body.gameSpecific ?? {},
      },
      body.reason,
    );
  }

  @Post(':gameId/versions/:versionId/activate')
  async activate(
    @Req() request: AuthenticatedRequest,
    @Param() params: VersionParams,
    @Body() body: ActivateVersionDto,
  ) {
    await this.throttle(request.actor.id);
    return this.configs.activateVersion(
      request.actor.id,
      params.gameId,
      params.versionId,
      body.expectedCurrentVersion,
    );
  }

  @Patch(':gameId/status')
  async setStatus(
    @Req() request: AuthenticatedRequest,
    @Param('gameId') gameId: string,
    @Body() body: GameStatusDto,
  ) {
    await this.throttle(request.actor.id);
    return this.configs.setStatus(request.actor.id, gameId, body);
  }
}

/** Platform-wide maintenance switches, kept off the per-game path. */
@Controller('admin/platform')
@UseGuards(AccessGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PlatformSettingsController {
  constructor(
    private readonly configs: CasinoConfigService,
    private readonly limits: RateLimitService,
  ) {}

  @Get('maintenance')
  async read(@Req() request: AuthenticatedRequest) {
    const settings = await this.configs.platformSettings();
    return {
      casinoMaintenance: settings.casinoMaintenance,
      sportsbookMaintenance: settings.sportsbookMaintenance,
      updatedAt: settings.updatedAt,
    };
  }

  @Patch('maintenance')
  async update(
    @Req() request: AuthenticatedRequest,
    @Body() body: PlatformMaintenanceDto,
  ) {
    await this.limits.consume('admin:config', request.actor.id, RATE_LIMITS.admin);
    return this.configs.setPlatformMaintenance(request.actor.id, body);
  }
}
