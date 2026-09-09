import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { CasinoGameType, CasinoRoundStatus, Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CasinoAdminService } from './casino-admin.service';

class AdminRoundsQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsEnum(CasinoGameType) gameType?: CasinoGameType;
  @IsOptional() @IsEnum(CasinoRoundStatus) status?: CasinoRoundStatus;
  @IsOptional() @IsUUID() userId?: string;
}

class AnalyticsQuery {
  @IsOptional() @IsIn(['24H', '7D', '30D', 'ALL']) period: '24H' | '7D' | '30D' | 'ALL' = 'ALL';
}

/** Administrator casino visibility. Read-only by construction: there are no writes here. */
@Controller('admin/casino')
@UseGuards(AccessGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CasinoAdminController {
  constructor(private readonly admin: CasinoAdminService) {}

  @Get('rounds')
  rounds(@Req() request: AuthenticatedRequest, @Query() query: AdminRoundsQuery) {
    return this.admin.listRounds(request.actor.id, query);
  }

  @Get('analytics')
  analytics(@Req() request: AuthenticatedRequest, @Query() query: AnalyticsQuery) {
    return this.admin.analytics(request.actor.id, query.period);
  }

  @Get('performance')
  performance(@Req() request: AuthenticatedRequest) {
    return this.admin.performance(request.actor.id);
  }
}
