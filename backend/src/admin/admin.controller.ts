import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { canManageUser, REACH_SELECT } from '../auth/capabilities';
import { Capabilities } from '../auth/capabilities.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { PrismaService } from '../prisma.service';
import { PointsService } from '../wallet/points.service';
import { CasinoAdminService } from '../casino/casino-admin.service';
class GrantDto { @IsInt() @Min(1) @Max(1_000_000_000) amount!: number; @IsString() @MinLength(1) reason!: string; @IsUUID() idempotencyKey!: string; }
class PageDto { @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25; }
class UserSearchDto extends PageDto { @IsOptional() @IsString() @MaxLength(120) search?: string; }
class RemoveDto { @IsInt() @Min(1) @Max(1_000_000_000) amount!: number; @IsString() @MinLength(1) reason!: string; @IsUUID() idempotencyKey!: string; }
@Controller('admin') @UseGuards(AccessGuard, RolesGuard) @Capabilities('USER_MANAGE')
export class AdminController {
  constructor(private readonly points: PointsService, private readonly prisma: PrismaService, private readonly limits: RateLimitService, private readonly casinoAdmin: CasinoAdminService) {}
  // An ADMIN manages/reads USER accounts only; SUPER_ADMIN sees every role.
  @Get('users') users(@Req() req: AuthenticatedRequest, @Query() page: UserSearchDto) {
    // SUPER_ADMIN: everyone. ADMIN: the managers they created and the players of those managers or their own.
    // MANAGER: only the players they created.
    const visibility = req.actor.role === Role.SUPER_ADMIN
      ? {}
      : req.actor.role === Role.ADMIN
        ? { OR: [{ role: Role.MANAGER, createdById: req.actor.id }, { role: Role.USER, OR: [{ createdById: req.actor.id }, { createdBy: { createdById: req.actor.id } }] }] }
        : { role: Role.USER, createdById: req.actor.id };
    return this.prisma.user.findMany({
      where: { AND: [visibility, page.search ? { OR: [{ email: { contains: page.search.trim(), mode: 'insensitive' } }, { username: { contains: page.search.trim(), mode: 'insensitive' } }] } : {}] },
      take: page.limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, username: true, email: true, role: true, disabled: true, createdAt: true, createdById: true, wallet: { select: { balance: true } } },
    });
  }
  @Get('users/:userId') async user(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string) {
    await this.assertVisibleUser(req.actor, id);
    return this.prisma.user.findUnique({ where: { id }, select: { id: true, username: true, email: true, role: true, disabled: true, createdAt: true, wallet: { select: { balance: true } } } });
  }
  @Get('users/:userId/detail') async detail(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string) {
    await this.assertVisibleUser(req.actor, id);
    return this.casinoAdmin.userDetail(req.actor.id, id);
  }
  @Get('users/:userId/ledger') async ledger(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string, @Query() page: PageDto) {
    await this.assertVisibleUser(req.actor, id);
    return this.prisma.ledgerEntry.findMany({ where: { wallet: { userId: id } }, take: page.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }
  /** Refuse (as not-found, to avoid disclosure) any target outside the actor's reach. */
  private async assertVisibleUser(actor: { id: string; role: Role }, id: string) {
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true, ...REACH_SELECT } });
    if (!target || !canManageUser(actor, target)) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return target;
  }
  @Get('audit') @Capabilities('AUDIT_VIEW') audit(@Query() page: PageDto) { return this.prisma.auditLog.findMany({ take: page.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }); }
  @Post('users/:userId/coins/remove') @Capabilities('PLAYER_POINTS_MANAGE') async remove(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string, @Body() body: RemoveDto) { await this.limits.consume('admin', req.actor.id, RATE_LIMITS.admin); return this.points.adminRemove(req.actor.id, id, BigInt(body.amount), body.reason, body.idempotencyKey); }
  @Post('users/:userId/coins/give') @Capabilities('PLAYER_POINTS_TRANSFER') async give(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string, @Body() body: GrantDto) { await this.limits.consume('admin', req.actor.id, RATE_LIMITS.admin); return this.points.managerTransfer(req.actor.id, id, BigInt(body.amount), body.reason, body.idempotencyKey, 'give'); }
  @Post('users/:userId/coins/take') @Capabilities('PLAYER_POINTS_TRANSFER') async take(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string, @Body() body: RemoveDto) { await this.limits.consume('admin', req.actor.id, RATE_LIMITS.admin); return this.points.managerTransfer(req.actor.id, id, BigInt(body.amount), body.reason, body.idempotencyKey, 'take'); }
  @Post('users/:userId/coins') @Capabilities('PLAYER_POINTS_MANAGE') async grant(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string, @Body() body: GrantDto) { await this.limits.consume('admin', req.actor.id, RATE_LIMITS.admin); return this.points.adminGrant(req.actor.id, id, BigInt(body.amount), body.reason, body.idempotencyKey); }
}
