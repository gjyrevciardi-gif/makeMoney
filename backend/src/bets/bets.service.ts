import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BetType, Prisma } from '@prisma/client';
import { SportsService } from '../sports/sports.service';
import { isBettableMarket, marketDefinition } from '../sports/markets';
import { PrismaService } from '../prisma.service';
import { CasinoConfigService } from '../casino/casino-config.service';
import { betsConfig } from './bets.config';
import { PlaceBetDto } from './place-bet.dto';
type Accepted = { event: Awaited<ReturnType<SportsService['getEventOdds']>>['event']; marketKey: string; marketName: string; selectionKey: string; selectionName: string; odds: Prisma.Decimal; point?: Prisma.Decimal };
@Injectable()
export class BetsService {
  private readonly config = betsConfig();
  constructor(private readonly prisma: PrismaService, private readonly sports: SportsService, private readonly platform: CasinoConfigService) {}
  private validateShape(input: PlaceBetDto) {
    if (!Number.isSafeInteger(input.stake) || input.stake <= 0) throw new BadRequestException('INVALID_STAKE');
    const count = input.selections.length;
    if (input.type === BetType.SINGLE && count !== 1) throw new BadRequestException('SINGLE_REQUIRES_ONE_SELECTION');
    if (input.type === BetType.ACCUMULATOR && (count < 2 || count > this.config.maxAccumulatorLegs)) throw new BadRequestException('INVALID_ACCUMULATOR_SIZE');
    if (BigInt(input.stake) > this.config.maxStake) throw new BadRequestException('STAKE_ABOVE_MAXIMUM');
    const logical = new Set(input.selections.map(s => `${s.eventId}:${s.marketKey}:${s.selectionKey}`));
    if (logical.size !== count) throw new BadRequestException('DUPLICATE_SELECTION');
    if (input.type === BetType.ACCUMULATOR && new Set(input.selections.map(s => s.eventId)).size !== count) throw new BadRequestException('ONE_SELECTION_PER_EVENT');
  }
  private async authoritative(input: PlaceBetDto): Promise<Accepted[]> {
    const changed: object[] = [];
    const accepted = await Promise.all(input.selections.map(async selection => {
      const odds = await this.sports.getEventOdds(selection.sportKey, selection.eventId);
      if (Date.parse(odds.staleAt) < Date.now() || Date.now() - Date.parse(odds.fetchedAt) > this.config.maxOddsStalenessSeconds * 1000) throw new ConflictException({ code: 'SPORTS_ODDS_UNAVAILABLE', message: 'Current odds are unavailable.' });
      if (Date.parse(odds.event.startTime) <= Date.now()) throw new ConflictException({ code: 'SELECTION_UNAVAILABLE', message: 'One or more selections are no longer available.' });
      const market = odds.markets.find(item => item.key === selection.marketKey); if (!market) throw new ConflictException({ code: 'SELECTION_UNAVAILABLE', message: 'One or more selections are no longer available.' });
      // The settlement gate (§5). Derived here from our own catalogue rather
      // than read off the payload, so a crafted request claiming `bettable`
      // cannot buy a stake on a market nothing can settle. A market we cannot
      // settle is refused even though the event page happily renders it.
      if (!isBettableMarket(market.key)) throw new ConflictException({ code: 'MARKET_NOT_BETTABLE', message: marketDefinition(market.key)?.unsettleableReason ?? 'This market is available to view only.', marketKey: market.key });
      // A provider that has pulled a market mid-event blocks the whole market;
      // taking the price anyway is how a book ends up on the wrong side of a
      // goal it already knows about (§8).
      if (market.suspended) throw new ConflictException({ code: 'SELECTION_SUSPENDED', message: 'This market is temporarily suspended.', marketKey: market.key });
      const current = market.selections.find(item => item.key === selection.selectionKey); if (!current) throw new ConflictException({ code: 'SELECTION_UNAVAILABLE', message: 'One or more selections are no longer available.' });
      if (current.suspended) throw new ConflictException({ code: 'SELECTION_SUSPENDED', message: 'This selection is temporarily suspended.', marketKey: market.key, selectionKey: current.key });
      const exact = new Prisma.Decimal(current.price);
      if (selection.displayedOdds && !exact.equals(new Prisma.Decimal(selection.displayedOdds))) changed.push({ eventId: selection.eventId, marketKey: selection.marketKey, selectionKey: selection.selectionKey, oldOdds: selection.displayedOdds, newOdds: exact.toString() });
      return { event: odds.event, marketKey: market.key, marketName: market.name, selectionKey: current.key, selectionName: current.name, odds: exact, point: current.point === undefined ? undefined : new Prisma.Decimal(current.point) };
    }));
    if (changed.length) throw new ConflictException({ code: 'ODDS_CHANGED', message: 'One or more prices changed.', selections: changed });
    return accepted;
  }
  async place(userId: string, input: PlaceBetDto) {
    // Maintenance blocks new stakes only. Result ingestion, settlement, winning
    // payouts and void refunds all continue, so nothing already staked is trapped.
    await this.platform.assertSportsbookOpen();
    const prior = await this.prisma.bet.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { legs: true } });
    if (prior) { if (prior.userId !== userId) throw new ConflictException('IDEMPOTENCY_KEY_CONFLICT'); return prior; }
    this.validateShape(input);
    const legs = await this.authoritative(input);
    const totalOdds = legs.reduce((value, leg) => value.mul(leg.odds), new Prisma.Decimal(1)).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
    const potentialPayout = BigInt(new Prisma.Decimal(input.stake).mul(totalOdds).toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR).toFixed(0));
    try {
      return await this.prisma.$transaction(async tx => {
        const duplicate = await tx.bet.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { legs: true } }); if (duplicate) return duplicate;
        const wallet = await tx.wallet.findUnique({ where: { userId } }); if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
        const debit = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: BigInt(input.stake) } }, data: { balance: { decrement: BigInt(input.stake) } } });
        if (debit.count !== 1) throw new ConflictException({ code: 'INSUFFICIENT_VIRTUAL_BALANCE', message: 'Insufficient virtual points.' });
        const bet = await tx.bet.create({ data: { userId, type: input.type, stake: BigInt(input.stake), totalOdds, potentialPayout, idempotencyKey: input.idempotencyKey, legs: { create: legs.map(leg => ({ provider: leg.event.provider, providerEventId: leg.event.providerEventId, sportKey: leg.event.sportKey, homeTeam: leg.event.homeTeam, awayTeam: leg.event.awayTeam, eventStartTime: new Date(leg.event.startTime), marketKey: leg.marketKey, marketName: leg.marketName, selectionKey: leg.selectionKey, selectionName: leg.selectionName, acceptedOdds: leg.odds, marketPoint: leg.point })) } }, include: { legs: true } });
        await tx.ledgerEntry.create({ data: { walletId: wallet.id, type: 'SPORTS_BET', amount: -BigInt(input.stake), reason: 'Sports bet stake', actorId: userId, relatedBetId: bet.id, idempotencyKey: `sports-bet:${input.idempotencyKey}` } });
        await tx.auditLog.create({ data: { actorId: userId, targetType: 'BET', targetId: bet.id, action: 'BET_PLACED', result: 'SUCCESS', metadata: { betType: input.type, stake: input.stake.toString(), selectionCount: legs.length } } });
        return bet;
      }, { maxWait: 10_000, timeout: 20_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.bet.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { legs: true } });
        if (duplicate?.userId === userId) return duplicate;
      }
      throw error;
    }
  }
}
