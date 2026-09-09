import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  BetStatus,
  Prisma,
  SettlementAttemptStatus,
  SettlementAttemptType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { SportsError } from '../sports/provider.errors';
import { SETTLEMENT_EVALUATORS } from './evaluators';
import {
  NormalizedEventResult,
  SPORTS_RESULT_PROVIDER,
  SportsResultProvider,
} from './result-provider';

type AttemptInput = {
  provider: string;
  providerEventId: string;
  betId?: string;
  betLegId?: string;
  attemptType: SettlementAttemptType;
  status: SettlementAttemptStatus;
  errorCode?: string;
  errorMessageSafe?: string;
  startedAt: Date;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SPORTS_RESULT_PROVIDER) private readonly provider: SportsResultProvider,
  ) {}

  private resultSummary(result: Pick<NormalizedEventResult, 'status' | 'homeScore' | 'awayScore'>) {
    return {
      status: result.status,
      homeScore: result.homeScore ?? null,
      awayScore: result.awayScore ?? null,
    };
  }

  private async recordAttempt(input: AttemptInput, deduplicateSince?: Date) {
    if (deduplicateSince) {
      const existing = await this.prisma.sportsSettlementAttempt.findFirst({
        where: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          betId: input.betId,
          betLegId: input.betLegId,
          attemptType: input.attemptType,
          status: input.status,
          errorCode: input.errorCode,
          createdAt: { gte: deduplicateSince },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return existing;
    }
    const prior = await this.prisma.sportsSettlementAttempt.findFirst({
      where: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        betId: input.betId,
        betLegId: input.betLegId,
        attemptType: input.attemptType,
        status: input.status,
        errorCode: input.errorCode,
      },
      orderBy: { createdAt: 'desc' },
      select: { retryCount: true },
    });
    return this.prisma.sportsSettlementAttempt.create({
      data: {
        ...input,
        finishedAt: new Date(),
        retryCount: prior ? prior.retryCount + 1 : 0,
      },
    });
  }

  private failureDetails(error: unknown) {
    if (error instanceof SportsError) {
      return {
        status: error.code === 'SPORTS_PROVIDER_RATE_LIMITED'
          ? SettlementAttemptStatus.RATE_LIMITED
          : SettlementAttemptStatus.FAILED,
        errorCode: error.code,
        errorMessageSafe: error.code === 'SPORTS_PROVIDER_RATE_LIMITED'
          ? 'The sports result provider rate limit was reached.'
          : 'The sports result provider was unavailable.',
      };
    }
    return {
      status: SettlementAttemptStatus.FAILED,
      errorCode: 'SPORTS_SETTLEMENT_FAILED',
      errorMessageSafe: 'Sports result processing failed.',
    };
  }

  async ingest(result: NormalizedEventResult) {
    if ((result.status === 'FINAL'
      && (!Number.isInteger(result.homeScore) || !Number.isInteger(result.awayScore)
        || result.homeScore! < 0 || result.awayScore! < 0))) {
      throw new SportsError('SPORTS_RESULT_INVALID_RESPONSE', 503);
    }
    const hash = createHash('sha256')
      .update(JSON.stringify(this.resultSummary(result)))
      .digest('hex');
    const incoming = this.resultSummary(result);

    const persisted = await this.prisma.$transaction(async (tx) => {
      const eventLock = `${result.provider}:${result.providerEventId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${eventLock}))`;
      const existing = await tx.sportsEventResult.findUnique({
        where: {
          provider_providerEventId: {
            provider: result.provider,
            providerEventId: result.providerEventId,
          },
        },
      });
      const existingSummary = existing && {
        status: existing.status,
        homeScore: existing.homeScore,
        awayScore: existing.awayScore,
      };
      const existingIsTerminal = existing?.status === 'FINAL' || existing?.status === 'CANCELLED';
      const conflicts = existingIsTerminal
        && JSON.stringify(existingSummary) !== JSON.stringify(incoming);

      if (existing && conflicts) {
        const storedSummary = {
          status: existing.status,
          homeScore: existing.homeScore,
          awayScore: existing.awayScore,
        };
        const lastConflict = await tx.sportsResultConflict.findFirst({
          where: {
            provider: result.provider,
            providerEventId: result.providerEventId,
            acknowledgedAt: null,
          },
          orderBy: { detectedAt: 'desc' },
        });
        if (!lastConflict
          || JSON.stringify(lastConflict.storedResult) !== JSON.stringify(storedSummary)
          || JSON.stringify(lastConflict.conflictingResult) !== JSON.stringify(incoming)) {
          await tx.sportsResultConflict.create({
            data: {
              provider: result.provider,
              providerEventId: result.providerEventId,
              storedResult: storedSummary,
              conflictingResult: incoming,
            },
          });
        }
        await tx.sportsSettlementAttempt.create({
          data: {
            provider: result.provider,
            providerEventId: result.providerEventId,
            attemptType: 'SETTLEMENT',
            status: 'CONFLICT',
            errorCode: 'SPORTS_RESULT_CONFLICT',
            errorMessageSafe: 'The provider result conflicts with the stored terminal result.',
            startedAt: new Date(),
            finishedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            targetType: 'SPORTS_EVENT',
            targetId: result.providerEventId,
            action: 'SPORTS_RESULT_CONFLICT',
            result: 'REVIEW_REQUIRED',
            metadata: { provider: result.provider, stored: storedSummary, received: incoming },
          },
        });
        return { stored: existing, conflict: true };
      }

      const data = {
        provider: result.provider,
        providerEventId: result.providerEventId,
        status: result.status,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        completedAt: result.completedAt,
        rawResultHash: hash,
        metadata: result.metadata as Prisma.InputJsonValue | undefined,
      };
      const stored = await tx.sportsEventResult.upsert({
        where: {
          provider_providerEventId: {
            provider: result.provider,
            providerEventId: result.providerEventId,
          },
        },
        create: data,
        update: {
          status: result.status,
          homeScore: result.homeScore,
          awayScore: result.awayScore,
          completedAt: result.completedAt,
          rawResultHash: hash,
          metadata: data.metadata,
        },
      });
      if (!existing) {
        await tx.auditLog.create({
          data: {
            targetType: 'SPORTS_EVENT',
            targetId: result.providerEventId,
            action: 'SPORTS_RESULT_RECEIVED',
            result: result.status,
            metadata: { provider: result.provider },
          },
        });
      }
      return { stored, conflict: false };
    }, { maxWait: 10_000, timeout: 20_000 });

    if (persisted.conflict) {
      this.logger.error({
        event: 'RESULT_CONFLICT_DETECTED',
        provider: result.provider,
        providerEventId: result.providerEventId,
      });
      return persisted.stored;
    }
    if (result.status === 'FINAL' || result.status === 'CANCELLED') {
      await this.settleEvent(result);
    }
    return persisted.stored;
  }

  private async settleEvent(result: NormalizedEventResult) {
    const bets = await this.prisma.betLeg.findMany({
      where: {
        provider: result.provider,
        providerEventId: result.providerEventId,
        status: 'OPEN',
        bet: { status: 'OPEN' },
      },
      select: { betId: true },
    });
    let failures = 0;
    for (const betId of [...new Set(bets.map((item) => item.betId))]) {
      const startedAt = new Date();
      try {
        await this.settleBet(betId, result);
      } catch (error) {
        failures += 1;
        const details = this.failureDetails(error);
        await this.recordAttempt({
          provider: result.provider,
          providerEventId: result.providerEventId,
          betId,
          attemptType: 'SETTLEMENT',
          startedAt,
          ...details,
        });
        this.logger.error({
          event: 'SPORTS_SETTLEMENT_FAILED',
          provider: result.provider,
          providerEventId: result.providerEventId,
          betId,
          code: details.errorCode,
        });
      }
    }
    return { betsChecked: new Set(bets.map((item) => item.betId)).size, failures };
  }

  private async settleBet(betId: string, result: NormalizedEventResult) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${betId}))`;
      const bet = await tx.bet.findUnique({
        where: { id: betId },
        include: { legs: true, user: { include: { wallet: true } } },
      });
      if (!bet || bet.status !== 'OPEN' || !bet.user.wallet) return;

      for (const leg of bet.legs.filter((item) => item.status === 'OPEN'
        && item.provider === result.provider
        && item.providerEventId === result.providerEventId)) {
        const evaluator = SETTLEMENT_EVALUATORS.find((item) => item.supports(leg.marketKey));
        const state = evaluator?.evaluate(leg, result) ?? 'UNRESOLVED';
        if (state === 'UNRESOLVED') {
          if (!evaluator) {
            const prior = await tx.sportsSettlementAttempt.findFirst({
              where: { betLegId: leg.id, status: 'UNSUPPORTED' },
              select: { id: true },
            });
            if (!prior) {
              await tx.sportsSettlementAttempt.create({
                data: {
                  provider: result.provider,
                  providerEventId: result.providerEventId,
                  betId,
                  betLegId: leg.id,
                  attemptType: 'SETTLEMENT',
                  status: 'UNSUPPORTED',
                  errorCode: 'UNSUPPORTED_SETTLEMENT_MARKET',
                  errorMessageSafe: 'The bet market is not supported by settlement.',
                  startedAt: new Date(),
                  finishedAt: new Date(),
                  metadata: { marketKey: leg.marketKey },
                },
              });
              await tx.auditLog.create({
                data: {
                  targetType: 'BET_LEG',
                  targetId: leg.id,
                  action: 'SPORTS_SETTLEMENT_FAILED',
                  result: 'UNSUPPORTED_SETTLEMENT_MARKET',
                  metadata: { marketKey: leg.marketKey },
                },
              });
            }
          }
          continue;
        }
        await tx.betLeg.update({
          where: { id: leg.id },
          data: {
            status: state,
            finalHomeScore: result.homeScore,
            finalAwayScore: result.awayScore,
            resultMetadata: { resultId: `${result.provider}:${result.providerEventId}` },
          },
        });
        await tx.auditLog.create({
          data: {
            targetType: 'BET_LEG',
            targetId: leg.id,
            action: 'BET_LEG_SETTLED',
            result: state,
          },
        });
      }

      const legs = await tx.betLeg.findMany({ where: { betId } });
      let status: BetStatus = 'OPEN';
      if (legs.some((leg) => leg.status === 'LOST')) status = 'LOST';
      else if (legs.some((leg) => leg.status === 'OPEN')) return;
      else if (legs.every((leg) => leg.status === 'VOID')) status = 'VOID';
      else status = 'WON';

      const finalOdds = legs
        .filter((leg) => leg.status === 'WON')
        .reduce((value, leg) => value.mul(leg.acceptedOdds), new Prisma.Decimal(1))
        .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);
      let payout = 0n;
      let ledgerType: 'SPORTS_WIN' | 'BET_VOID_REFUND' | undefined;
      if (status === 'WON') {
        payout = BigInt(new Prisma.Decimal(bet.stake.toString())
          .mul(finalOdds)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR)
          .toFixed(0));
        ledgerType = 'SPORTS_WIN';
      }
      if (status === 'VOID') {
        payout = bet.stake;
        ledgerType = 'BET_VOID_REFUND';
      }
      if (ledgerType) {
        const key = `sports:settlement:${status.toLowerCase()}:${bet.id}`;
        const entry = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
        if (!entry) {
          await tx.ledgerEntry.create({
            data: {
              walletId: bet.user.wallet.id,
              type: ledgerType,
              amount: payout,
              reason: status === 'WON'
                ? 'Sportsbook winning payout'
                : 'Voided sports bet refund',
              relatedBetId: bet.id,
              idempotencyKey: key,
            },
          });
          await tx.wallet.update({
            where: { id: bet.user.wallet.id },
            data: { balance: { increment: payout } },
          });
        }
      }
      await tx.bet.update({
        where: { id: bet.id },
        data: { status, finalOdds, actualPayout: payout, settledAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          targetType: 'BET',
          targetId: bet.id,
          action: status === 'VOID' ? 'BET_VOIDED' : 'BET_SETTLED',
          result: status,
          metadata: {
            userId: bet.userId,
            stake: bet.stake.toString(),
            finalOdds: finalOdds.toString(),
            payout: payout.toString(),
            legCount: legs.length,
          },
        },
      });
    }, { maxWait: 10_000, timeout: 20_000 });
  }

  private async fetchAndIngest(leg: {
    provider: string;
    providerEventId: string;
    sportKey: string;
    homeTeam: string;
    awayTeam: string;
  }, persistNoResult: boolean) {
    const startedAt = new Date();
    try {
      const result = await this.provider.getEventResult(
        leg.sportKey,
        leg.providerEventId,
        leg.homeTeam,
        leg.awayTeam,
      );
      if (!result) {
        await this.recordAttempt({
          provider: leg.provider,
          providerEventId: leg.providerEventId,
          attemptType: 'RESULT_FETCH',
          status: 'NO_RESULT',
          errorCode: 'NO_RESULT_RETURNED',
          errorMessageSafe: 'The provider did not return a result for this event.',
          startedAt,
        }, persistNoResult ? undefined : new Date(Date.now() - 60 * 60 * 1000));
        return { status: 'NO_RESULT' as const };
      }
      if (result.provider !== leg.provider || result.providerEventId !== leg.providerEventId) {
        throw new SportsError('SPORTS_RESULT_IDENTITY_MISMATCH', 503);
      }
      const stored = await this.ingest(result);
      return { status: 'PROCESSED' as const, resultStatus: stored.status };
    } catch (error) {
      const details = this.failureDetails(error);
      await this.recordAttempt({
        provider: leg.provider,
        providerEventId: leg.providerEventId,
        attemptType: 'RESULT_FETCH',
        startedAt,
        ...details,
      });
      this.logger.warn({
        event: details.status === 'RATE_LIMITED'
          ? 'RESULT_FETCH_RATE_LIMITED'
          : 'RESULT_FETCH_FAILED',
        provider: leg.provider,
        providerEventId: leg.providerEventId,
        code: details.errorCode,
      });
      throw error;
    }
  }

  async reconcileEvent(provider: string, providerEventId: string) {
    const leg = await this.prisma.betLeg.findFirst({
      where: { provider, providerEventId },
      orderBy: { createdAt: 'desc' },
      select: {
        provider: true,
        providerEventId: true,
        sportKey: true,
        homeTeam: true,
        awayTeam: true,
      },
    });
    if (!leg) throw new NotFoundException('SPORTS_EVENT_NOT_FOUND');
    return this.fetchAndIngest(leg, true);
  }

  async runOnce() {
    const legs = await this.prisma.betLeg.findMany({
      where: {
        status: 'OPEN',
        eventStartTime: { lte: new Date() },
        bet: { status: 'OPEN' },
      },
      distinct: ['provider', 'providerEventId'],
      take: 250,
      orderBy: { eventStartTime: 'asc' },
      select: {
        provider: true,
        providerEventId: true,
        sportKey: true,
        homeTeam: true,
        awayTeam: true,
      },
    });
    let failures = 0;
    for (const leg of legs) {
      try {
        await this.fetchAndIngest(leg, false);
      } catch {
        failures += 1;
      }
    }
    return { eventsChecked: legs.length, failures };
  }
}
