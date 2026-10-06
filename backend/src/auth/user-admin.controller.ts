import { Body, Controller, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsEnum } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from './access.guard';
import { AuthorizationService } from './authorization.service';
import { Capabilities } from './capabilities.decorator';
import { RolesGuard } from './roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';

class RoleChangeDto {
  @IsEnum(Role) role!: Role;
}

class StatusChangeDto {
  @IsBoolean() disabled!: boolean;
}

/**
 * Administrative user management: role changes and account status.
 *
 * Route-level capability gating is a first line only; the authoritative
 * target-role checks, self-change refusal and last-super-admin guard all live in
 * `AuthorizationService` and re-read the database inside the transaction.
 */
@Controller('admin/users')
@UseGuards(AccessGuard, RolesGuard)
@Capabilities('USER_MANAGE')
export class UserAdminController {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly limits: RateLimitService,
  ) {}

  /** Same per-actor budget as the other privileged admin mutations. */
  private throttle(actorId: string) {
    return this.limits.consume('admin:users', actorId, RATE_LIMITS.admin);
  }

  @Post(':userId/role')
  async changeRole(
    @Req() request: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: RoleChangeDto,
  ) {
    await this.throttle(request.actor.id);
    return this.authorization.changeRole(request.actor.id, userId, body.role);
  }

  @Post(':userId/status')
  async setStatus(
    @Req() request: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: StatusChangeDto,
  ) {
    await this.throttle(request.actor.id);
    return this.authorization.setDisabled(request.actor.id, userId, body.disabled);
  }
}
