import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BetType, Prisma } from '@prisma/client';
import { SportsService } from '../sports/sports.service';
import { PrismaService } from '../prisma.service';
import { CasinoConfigService } from '../casino/casino-config.service';
import { betsConfig } from './bets.config';
import { PlaceBetDto } from './place-bet.dto';
import { isConcurrentPlacementAbort, placementFingerprint } from './bet-idempotency';
type Accepted = { event: Awaited<ReturnType<SportsService['getEventOdds']>>['event']; marketKey: string; marketName: string; selectionKey: string; selectionName: string; odds: Prisma.Decimal; point?: Prisma.Decimal };
type PersistedBet = Prisma.BetGetPayload<{ include: { legs: true } }>;
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
      const current = market.selections.find(item => item.key === selection.selectionKey); if (!current) throw new ConflictException({ code: 'SELECTION_UNAVAILABLE', message: 'One or more selections are no longer available.' });
      const exact = new Prisma.Decimal(current.price);
      if (selection.displayedOdds && !exact.equals(new Prisma.Decimal(selection.displayedOdds))) changed.push({ eventId: selection.eventId, marketKey: selection.marketKey, selectionKey: selection.selectionKey, oldOdds: selection.displayedOdds, newOdds: exact.toString() });
      return { event: odds.event, marketKey: market.key, marketName: market.name, selectionKey: current.key, selectionName: current.name, odds: exact, point: current.point === undefined ? undefined : new Prisma.Decimal(current.point) };
    }));
    if (changed.length) throw new ConflictException({ code: 'ODDS_CHANGED', message: 'One or more prices changed.', selections: changed });
    return accepted;
  }
  /**
   * The single generic conflict thrown by every idempotency path.
   *
   * It never carries a bet id, owner, balance or raw Prisma detail, so a caller
   * cannot learn *whose* key it is or what the stored bet contains. It does not
   * hide that the key has been used: the conflict itself says so, and a caller
   * who can produce a request can always probe one key at a time.
   */
  private idempotencyConflict() {
    return new ConflictException({ code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'This idempotency key was used for a different request.' });
  }
  /**
   * The one replay rule, shared by the pre-check, the in-transaction lookup and
   * every post-rollback recovery.
   *
   * A retry is answered with the stored bet only when the caller owns it and the
   * stored request carries a fingerprint that proves it is the same placement.
   * Anything else - a different owner, a changed payload, or a legacy row with
   * no fingerprint - throws the same generic conflict and never debits.
   */
  private resolveReplay(stored: PersistedBet, userId: string, input: PlaceBetDto): PersistedBet {
    if (stored.userId !== userId) throw this.idempotencyConflict();
    if (stored.idempotencyCanonicalHash === null) {
      // Legacy rows predate the fingerprint column and cannot prove which request
      // produced them: a caller that omitted `displayedOdds` and one that echoed
      // the accepted price persist identically, so the original request is
      // unrecoverable and an unprovable retry fails closed. The row itself is
      // untouched and stays readable through the normal retrieval paths.
      throw this.idempotencyConflict();
    }
    if (stored.idempotencyCanonicalHash !== placementFingerprint(input)) throw this.idempotencyConflict();
    return stored;
  }
  async place(userId: string, input: PlaceBetDto) {
    // Maintenance blocks new stakes only. Result ingestion, settlement, winning
    // payouts and void refunds all continue, so nothing already staked is trapped.
    await this.platform.assertSportsbookOpen();
    const prior = await this.prisma.bet.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { legs: true } });
    if (prior) return this.resolveReplay(prior, userId, input);
    this.validateShape(input);
    const legs = await this.authoritative(input);
    const totalOdds = legs.reduce((value, leg) => value.mul(leg.odds), new Prisma.Decimal(1)).toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
    const potentialPayout = BigInt(new Prisma.Decimal(input.stake).mul(totalOdds).toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR).toFixed(0));
    const fingerprint = placementFingerprint(input);
    try {
      return await this.prisma.$transaction(async tx => {
        const duplicate = await tx.bet.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { legs: true } }); if (duplicate) return this.resolveReplay(duplicate, userId, input);
        const wallet = await tx.wallet.findUnique({ where: { userId } }); if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
        const debit = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: BigInt(input.stake) } }, data: { balance: { decrement: BigInt(input.stake) } } });
        if (debit.count !== 1) throw new ConflictException({ code: 'INSUFFICIENT_VIRTUAL_BALANCE', message: 'Insufficient virtual points.' });
        const bet = await tx.bet.create({ data: { userId, type: input.type, stake: BigInt(input.stake), totalOdds, potentialPayout, idempotencyKey: input.idempotencyKey, idempotencyCanonicalHash: fingerprint, legs: { create: legs.map(leg => ({ provider: leg.event.provider, providerEventId: leg.event.providerEventId, sportKey: leg.event.sportKey, homeTeam: leg.event.homeTeam, awayTeam: leg.event.awayTeam, eventStartTime: new Date(leg.event.startTime), marketKey: leg.marketKey, marketName: leg.marketName, selectionKey: leg.selectionKey, selectionName: leg.selectionName, acceptedOdds: leg.odds, marketPoint: leg.point })) } }, include: { legs: true } });
        await tx.ledgerEntry.create({ data: { walletId: wallet.id, type: 'SPORTS_BET', amount: -BigInt(input.stake), reason: 'Sports bet stake', actorId: userId, relatedBetId: bet.id, idempotencyKey: `sports-bet:${input.idempotencyKey}` } });
        await tx.auditLog.create({ data: { actorId: userId, targetType: 'BET', targetId: bet.id, action: 'BET_PLACED', result: 'SUCCESS', metadata: { betType: input.type, stake: input.stake.toString(), selectionCount: legs.length } } });
        return bet;
      }, { maxWait: 10_000, timeout: 20_000 });
    } catch (error) {
      if (!isConcurrentPlacementAbort(error)) throw error;
      // The transaction rolled back, so none of our own debit, bet or ledger
      // rows survive it. If a concurrent request with this key committed the
      // identical placement while we waited on the wallet row (or on the unique
      // index), that stored row is the honest answer; otherwise the original
      // failure keeps its own meaning.
      const stored = await this.prisma.bet.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { legs: true },
      });
      if (!stored) {
        // A unique violation always has a row behind it; if it cannot be read
        // back, answer with the generic conflict rather than the raw constraint
        // error.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw this.idempotencyConflict();
        throw error;
      }
      return this.resolveReplay(stored, userId, input);
    }
  }
}
