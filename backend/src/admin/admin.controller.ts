import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { PrismaService } from '../prisma.service';
import { PointsService } from '../wallet/points.service';
import { CasinoAdminService } from '../casino/casino-admin.service';
class GrantDto { @IsInt() @Min(1) @Max(1_000_000_000) amount!: number; @IsString() @MinLength(1) reason!: string; @IsUUID() idempotencyKey!: string; }
class PageDto { @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25; }
class UserSearchDto extends PageDto { @IsOptional() @IsString() @MaxLength(120) search?: string; }
class RemoveDto { @IsInt() @Min(1) @Max(1_000_000_000) amount!: number; @IsString() @MinLength(1) reason!: string; @IsUUID() idempotencyKey!: string; }
@Controller('admin') @UseGuards(AccessGuard, RolesGuard) @Roles(Role.ADMIN)
export class AdminController {
  constructor(private readonly points: PointsService, private readonly prisma: PrismaService, private readonly limits: RateLimitService, private readonly casinoAdmin: CasinoAdminService) {}
  @Get('users') users(@Query() page: UserSearchDto) { return this.prisma.user.findMany({ where: page.search ? { email: { contains: page.search.trim(), mode: 'insensitive' } } : undefined, take: page.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, email: true, role: true, createdAt: true, wallet: { select: { balance: true } } } }); }
  @Get('users/:userId') user(@Param('userId', ParseUUIDPipe) id: string) { return this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, createdAt: true, wallet: { select: { balance: true } } } }); }
  @Get('users/:userId/detail') detail(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string) { return this.casinoAdmin.userDetail(req.actor.id, id); }
  @Get('users/:userId/ledger') ledger(@Param('userId', ParseUUIDPipe) id: string, @Query() page: PageDto) { return this.prisma.ledgerEntry.findMany({ where: { wallet: { userId: id } }, take: page.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }); }
  @Get('audit') audit(@Query() page: PageDto) { return this.prisma.auditLog.findMany({ take: page.limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }); }
  @Post('users/:userId/coins/remove') async remove(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string, @Body() body: RemoveDto) { await this.limits.consume('admin', req.actor.id, RATE_LIMITS.admin); return this.points.adminRemove(req.actor.id, id, BigInt(body.amount), body.reason, body.idempotencyKey); }
  @Post('users/:userId/coins') async grant(@Req() req: AuthenticatedRequest, @Param('userId', ParseUUIDPipe) id: string, @Body() body: GrantDto) { await this.limits.consume('admin', req.actor.id, RATE_LIMITS.admin); return this.points.adminGrant(req.actor.id, id, BigInt(body.amount), body.reason, body.idempotencyKey); }
}
