import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { BetStatus, BetType } from '@prisma/client';
import { UserAccountsService, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth/user-accounts.service';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
class ChangePasswordDto { @IsString() @Length(1, MAX_PASSWORD_LENGTH) currentPassword!: string; @IsString() @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH) newPassword!: string; }
class PageDto { @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25; }
class BetPageDto extends PageDto { @IsOptional() @IsEnum(BetStatus) status?: BetStatus; @IsOptional() @IsEnum(BetType) type?: BetType; }
@Controller() @UseGuards(AccessGuard)
export class PrivateController {
  constructor(private readonly prisma: PrismaService, private readonly accounts: UserAccountsService, private readonly limits: RateLimitService) {}
  @Post('users/me/password') async changePassword(@Req() req: AuthenticatedRequest, @Body() body: ChangePasswordDto) {
    // Failed attempts share the login failure budget, so a stolen session cannot guess the current password.
    await this.limits.assertAllowed('password-change', req.actor.id, RATE_LIMITS.loginFailures);
    try { await this.accounts.changeOwnPassword(req.actor.id, body.currentPassword, body.newPassword); }
    catch (error) { await this.limits.consume('password-change', req.actor.id, RATE_LIMITS.loginFailures); throw error; }
    return { success: true };
  }
  @Get('users/me') me(@Req() req: AuthenticatedRequest) { return this.prisma.user.findUnique({ where: { id: req.actor.id }, select: { id: true, username: true, email: true, role: true, createdAt: true } }); }
  @Get('wallet/me') wallet(@Req() req: AuthenticatedRequest) { return this.prisma.wallet.findUnique({ where: { userId: req.actor.id }, select: { id: true, balance: true, createdAt: true } }); }
  @Get('wallet/me/ledger') ledger(@Req() req: AuthenticatedRequest, @Query() page: PageDto) { return this.prisma.ledgerEntry.findMany({ where: { wallet: { userId: req.actor.id } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.limit, select: { id: true, type: true, amount: true, reason: true, relatedBetId: true, createdAt: true } }); }
  @Get('bets/me') bets(@Req() req: AuthenticatedRequest, @Query() page: BetPageDto) { return this.prisma.bet.findMany({ where: { userId: req.actor.id, status: page.status, type: page.type }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.limit, include: { legs: true } }); }
  @Get('bets/:betId') async bet(@Req() req: AuthenticatedRequest, @Param('betId', ParseUUIDPipe) betId: string) { const bet = await this.prisma.bet.findFirst({ where: { id: betId, userId: req.actor.id }, include: { legs: true } }); if (!bet) throw new NotFoundException('NOT_FOUND'); return bet; }
}
