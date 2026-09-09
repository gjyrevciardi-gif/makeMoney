import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma.service';
import { AccessGuard, AuthenticatedRequest } from '../auth/access.guard';
import { BetStatus, BetType } from '@prisma/client';
class PageDto { @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25; }
class BetPageDto extends PageDto { @IsOptional() @IsEnum(BetStatus) status?: BetStatus; @IsOptional() @IsEnum(BetType) type?: BetType; }
@Controller() @UseGuards(AccessGuard)
export class PrivateController {
  constructor(private readonly prisma: PrismaService) {}
  @Get('users/me') me(@Req() req: AuthenticatedRequest) { return this.prisma.user.findUnique({ where: { id: req.actor.id }, select: { id: true, email: true, role: true, createdAt: true } }); }
  @Get('wallet/me') wallet(@Req() req: AuthenticatedRequest) { return this.prisma.wallet.findUnique({ where: { userId: req.actor.id }, select: { id: true, balance: true, createdAt: true } }); }
  @Get('wallet/me/ledger') ledger(@Req() req: AuthenticatedRequest, @Query() page: PageDto) { return this.prisma.ledgerEntry.findMany({ where: { wallet: { userId: req.actor.id } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.limit, select: { id: true, type: true, amount: true, reason: true, relatedBetId: true, createdAt: true } }); }
  @Get('bets/me') bets(@Req() req: AuthenticatedRequest, @Query() page: BetPageDto) { return this.prisma.bet.findMany({ where: { userId: req.actor.id, status: page.status, type: page.type }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: page.limit, include: { legs: true } }); }
  @Get('bets/:betId') async bet(@Req() req: AuthenticatedRequest, @Param('betId', ParseUUIDPipe) betId: string) { const bet = await this.prisma.bet.findFirst({ where: { id: betId, userId: req.actor.id }, include: { legs: true } }); if (!bet) throw new NotFoundException('NOT_FOUND'); return bet; }
}
