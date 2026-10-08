import { Body, Controller, Header, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from './access.guard';
import { AuthorizationService } from './authorization.service';
import { Capabilities } from './capabilities.decorator';
import { RolesGuard } from './roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { MfaService } from './mfa.service';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, UserAccountsService } from './user-accounts.service';

class RoleChangeDto {
  @IsEnum(Role) role!: Role;
}

class StatusChangeDto {
  @IsBoolean() disabled!: boolean;
}

class CreateUserDto {
  @IsString() @Length(3, 32) username!: string;
  /** Omit to have the server generate one (returned once, and revealable afterwards). */
  @IsOptional() @IsString() @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH) password?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
}

class PasswordDto {
  @IsString() @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH) password!: string;
}

class OwnerDto {
  @IsUUID() ownerId!: string;
}

class UsernameDto {
  @IsString() @Length(3, 32) username!: string;
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
    private readonly accounts: UserAccountsService,
    private readonly mfa: MfaService,
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
  /** Create an account. An ADMIN creates USERs; only a SUPER_ADMIN creates an ADMIN. */
  @Post()
  @Header('Cache-Control', 'no-store')
  async create(@Req() request: AuthenticatedRequest, @Body() body: CreateUserDto) {
    await this.throttle(request.actor.id);
    return this.accounts.createUser(request.actor.id, body);
  }

  /** Set or reset a user's password. Their refresh tokens are revoked. */
  @Post(':userId/password')
  @Header('Cache-Control', 'no-store')
  async setPassword(
    @Req() request: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: PasswordDto,
  ) {
    await this.throttle(request.actor.id);
    return this.accounts.setPassword(request.actor.id, userId, body.password);
  }

  /** Read a user's current password back. POST (not GET) and no-store; every reveal is audited. */
  @Post(':userId/password/reveal')
  @Header('Cache-Control', 'no-store')
  async revealPassword(@Req() request: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.throttle(request.actor.id);
    return this.accounts.revealPassword(request.actor.id, userId);
  }

  @Post(':userId/mfa/reset')
  async resetMfa(@Req() request: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.throttle(request.actor.id);
    await this.mfa.reset(request.actor.id, userId);
    return { id: userId };
  }

  @Post(':userId/owner')
  async setOwner(
    @Req() request: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: OwnerDto,
  ) {
    await this.throttle(request.actor.id);
    return this.accounts.setOwner(request.actor.id, userId, body.ownerId);
  }

  @Post(':userId/username')
  async setUsername(
    @Req() request: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UsernameDto,
  ) {
    await this.throttle(request.actor.id);
    return this.accounts.setUsername(request.actor.id, userId, body.username);
  }
}
