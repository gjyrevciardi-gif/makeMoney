import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma, Role, SportsResultStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SettlementService } from '../settlement/settlement.service';
import { OperationsHealthService } from './operations-health.service';
import { sportsOperationsConfig } from './sports-operations.config';

type EventKey = { provider: string; providerEventId: string };

const TERMINAL_RESULTS: SportsResultStatus[] = ['FINAL', 'CANCELLED'];

/**
 * Read-mostly operational surface for sportsbook administrators.
 *
 * Every method re-checks the ADMIN role against the current database row rather
 * than trusting the access-token claim, so a demoted administrator immediately
 * loses operational authority. The only mutating capability exposed here is a
 * request for another authoritative provider reconciliation: an administrator
 * can never submit a winner, score, payout, or bet status.
 */
@Injectable()
export class SportsOperationsService {
  private readonly logger = new Logger(SportsOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlement: SettlementService,
    private readonly health: OperationsHealthService,
  ) {}

  private async assertAdmin(actorId: string, action: string, targetId?: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    });
    if (actor?.role === Role.ADMIN) return;
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'SPORTS_OPERATIONS',
        targetId: targetId ?? action,
        action: 'PERMISSION_DENIED',
        result: 'DENIED',
        metadata: { operation: action },
      },
    });
    throw new ForbiddenException('ADMIN_REQUIRED');
  }

  private eventFilter(keys: EventKey[]): Prisma.BetLegWhereInput | undefined {
    if (!keys.length) return undefined;
    return {
      OR: keys.map((key) => ({
        provider: key.provider,
        providerEventId: key.providerEventId,
      })),
    };
  }

  private staleReason(
    storedStatus: SportsResultStatus | undefined,
    attemptStatus: string | undefined,
  ) {
    if (attemptStatus === 'NO_RESULT') return 'NO_RESULT_RETURNED';
    if (attemptStatus === 'UNSUPPORTED') return 'UNSUPPORTED_SETTLEMENT_MARKET';
    if (attemptStatus === 'FAILED' || attemptStatus === 'RATE_LIMITED') {
      return 'LAST_ATTEMPT_FAILED';
    }
    if (storedStatus && TERMINAL_RESULTS.includes(storedStatus)) {
      return 'WAITING_FOR_SETTLEMENT_RETRY';
    }
    if (storedStatus) return 'WAITING_FOR_FINAL_RESULT';
    if (!attemptStatus) return 'NOT_YET_PROCESSED';
    return 'WAITING_FOR_FINAL_RESULT';
  }

  /**
   * OPEN bets whose event started long enough ago that a final result was
   * expected. Purely diagnostic: no domain, wallet, or ledger state is touched.
   */
  /**
   * The dashboard's headline counters.
   *
   * Every figure is an aggregate computed by PostgreSQL: no bet, attempt or
   * conflict row is ever loaded into this process, so the endpoint stays cheap
   * as those tables grow. It also reads nothing but our own tables — the odds
   * provider is never called and no quota is spent — so the overview keeps
   * answering while the provider is unavailable, which is exactly when an
   * administrator is most likely to be looking at it.
   *
   * Each count uses the same predicate as the list rendered beneath it, so a
   * card can never disagree with the table it sits above.
   */
  async overview(actorId: string) {
    await this.assertAdmin(actorId, 'SPORTS_OVERVIEW');
    const { staleBetAfterMinutes } = sportsOperationsConfig();
    const staleThreshold = new Date(Date.now() - staleBetAfterMinutes * 60_000);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [openBets, staleOpenBets, settledByStatus, settlementFailuresLast24h, resultConflicts, openEvents] =
      await Promise.all([
        this.prisma.bet.count({ where: { status: 'OPEN' } }),
        // Counted over the relation rather than over legs: a bet with three
        // stale legs is one stale bet, which is what `staleBets` below lists.
        this.prisma.bet.count({
          where: {
            status: 'OPEN',
            legs: { some: { status: 'OPEN', eventStartTime: { lte: staleThreshold } } },
          },
        }),
        // One grouped query answers settled/won/lost/void rather than four counts.
        this.prisma.bet.groupBy({
          by: ['status'],
          where: { status: { in: ['WON', 'LOST', 'VOID'] }, settledAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.sportsSettlementAttempt.count({
          where: {
            status: { in: ['FAILED', 'RATE_LIMITED', 'CONFLICT', 'UNSUPPORTED'] },
            resolvedAt: null,
            createdAt: { gte: since },
          },
        }),
        // The card reads "require investigation", so an acknowledged conflict is
        // no longer counted even though the table below still lists it.
        this.prisma.sportsResultConflict.count({ where: { acknowledgedAt: null } }),
        // Distinct events carrying an open leg. Bounded by fixtures actually bet
        // on, not by the size of the leg table.
        this.prisma.betLeg.groupBy({
          by: ['provider', 'providerEventId'],
          where: { status: 'OPEN', bet: { status: 'OPEN' } },
        }),
      ]);

    // An open leg whose event already has a terminal result is waiting on
    // settlement, not on the provider, so it is not "awaiting result".
    const openEventKeys = openEvents.map((row) => ({
      provider: row.provider,
      providerEventId: row.providerEventId,
    }));
    const eventsWithResult = openEventKeys.length
      ? await this.prisma.sportsEventResult.count({
        where: { status: { in: TERMINAL_RESULTS }, OR: openEventKeys },
      })
      : 0;

    const settledCount = (status: 'WON' | 'LOST' | 'VOID') =>
      settledByStatus.find((row) => row.status === status)?._count._all ?? 0;
    const winsLast24h = settledCount('WON');
    const lossesLast24h = settledCount('LOST');
    const voidsLast24h = settledCount('VOID');

    return {
      openBets,
      staleOpenBets,
      settledLast24h: winsLast24h + lossesLast24h + voidsLast24h,
      winsLast24h,
      lossesLast24h,
      voidsLast24h,
      settlementFailuresLast24h,
      resultConflicts,
      eventsAwaitingResult: Math.max(openEventKeys.length - eventsWithResult, 0),
    };
  }

  async staleBets(actorId: string, limit: number) {
    await this.assertAdmin(actorId, 'STALE_BETS');
    const { staleBetAfterMinutes } = sportsOperationsConfig();
    const threshold = new Date(Date.now() - staleBetAfterMinutes * 60_000);
    const legs = await this.prisma.betLeg.findMany({
      where: {
        status: 'OPEN',
        eventStartTime: { lte: threshold },
        bet: { status: 'OPEN' },
      },
      orderBy: [{ eventStartTime: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        betId: true,
        provider: true,
        providerEventId: true,
        sportKey: true,
        homeTeam: true,
        awayTeam: true,
        marketKey: true,
        eventStartTime: true,
        bet: {
          select: { stake: true, type: true, createdAt: true },
        },
      },
    });
    if (!legs.length) return { staleAfterMinutes: staleBetAfterMinutes, bets: [] };

    const keys = [
      ...new Map(
        legs.map((leg) => [
          `${leg.provider}:${leg.providerEventId}`,
          { provider: leg.provider, providerEventId: leg.providerEventId },
        ]),
      ).values(),
    ];
    const [results, attempts] = await Promise.all([
      this.prisma.sportsEventResult.findMany({
        where: { OR: keys },
        select: { provider: true, providerEventId: true, status: true },
      }),
      this.prisma.sportsSettlementAttempt.findMany({
        where: { OR: keys },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          provider: true,
          providerEventId: true,
          status: true,
          errorCode: true,
          createdAt: true,
        },
      }),
    ]);
    const resultByEvent = new Map(
      results.map((row) => [`${row.provider}:${row.providerEventId}`, row]),
    );
    const attemptByEvent = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) {
      const key = `${attempt.provider}:${attempt.providerEventId}`;
      if (!attemptByEvent.has(key)) attemptByEvent.set(key, attempt);
    }

    type StaleBet = {
      betId: string;
      stake: bigint;
      type: string;
      placedAt: Date;
      openLegs: unknown[];
    };
    const bets = new Map<string, StaleBet>();
    for (const leg of legs) {
      const key = `${leg.provider}:${leg.providerEventId}`;
      const stored = resultByEvent.get(key);
      const attempt = attemptByEvent.get(key);
      const entry = bets.get(leg.betId) ?? {
        betId: leg.betId,
        stake: leg.bet.stake,
        type: leg.bet.type,
        placedAt: leg.bet.createdAt,
        openLegs: [],
      };
      entry.openLegs.push({
        betLegId: leg.id,
        provider: leg.provider,
        providerEventId: leg.providerEventId,
        sportKey: leg.sportKey,
        homeTeam: leg.homeTeam,
        awayTeam: leg.awayTeam,
        marketKey: leg.marketKey,
        eventStartTime: leg.eventStartTime,
        minutesSinceStart: Math.floor((Date.now() - leg.eventStartTime.getTime()) / 60_000),
        storedResultStatus: stored?.status ?? null,
        lastAttemptStatus: attempt?.status ?? null,
        lastAttemptErrorCode: attempt?.errorCode ?? null,
        lastAttemptAt: attempt?.createdAt ?? null,
        reason: this.staleReason(stored?.status, attempt?.status),
      });
      bets.set(leg.betId, entry);
    }
    return { staleAfterMinutes: staleBetAfterMinutes, bets: [...bets.values()] };
  }

  /** Unresolved settlement/result-fetch attempts, with provider-safe messages only. */
  async settlementFailures(actorId: string, limit: number) {
    await this.assertAdmin(actorId, 'SETTLEMENT_FAILURES');
    const attempts = await this.prisma.sportsSettlementAttempt.findMany({
      where: {
        status: { in: ['FAILED', 'RATE_LIMITED', 'CONFLICT', 'UNSUPPORTED'] },
        resolvedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        provider: true,
        providerEventId: true,
        betId: true,
        betLegId: true,
        attemptType: true,
        status: true,
        errorCode: true,
        errorMessageSafe: true,
        retryCount: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });
    return { attempts };
  }

  /**
   * Terminal-result contradictions detected during ingest. A conflict never
   * reverses an already-settled payout; it is surfaced for human review.
   */
  async conflicts(actorId: string, limit: number) {
    await this.assertAdmin(actorId, 'RESULT_CONFLICTS');
    const rows = await this.prisma.sportsResultConflict.findMany({
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        provider: true,
        providerEventId: true,
        storedResult: true,
        conflictingResult: true,
        detectedAt: true,
        acknowledgedBy: true,
        acknowledgedAt: true,
        acknowledgementNote: true,
      },
    });
    const filter = this.eventFilter(rows);
    const legs = filter
      ? await this.prisma.betLeg.findMany({
        where: filter,
        select: { betId: true, provider: true, providerEventId: true },
      })
      : [];
    const betsByEvent = new Map<string, Set<string>>();
    for (const leg of legs) {
      const key = `${leg.provider}:${leg.providerEventId}`;
      const set = betsByEvent.get(key) ?? new Set<string>();
      set.add(leg.betId);
      betsByEvent.set(key, set);
    }
    return {
      conflicts: rows.map((row) => ({
        ...row,
        affectedBetIds: [...(betsByEvent.get(`${row.provider}:${row.providerEventId}`) ?? [])],
      })),
    };
  }

  /** Everything an administrator needs to judge one event before reconciling. */
  async reconciliation(actorId: string, provider: string, providerEventId: string) {
    await this.assertAdmin(actorId, 'EVENT_RECONCILIATION_VIEW', providerEventId);
    const [storedResult, attempts, conflicts, legs] = await Promise.all([
      this.prisma.sportsEventResult.findUnique({
        where: { provider_providerEventId: { provider, providerEventId } },
        select: {
          status: true,
          homeScore: true,
          awayScore: true,
          completedAt: true,
          receivedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.sportsSettlementAttempt.findMany({
        where: { provider, providerEventId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        select: {
          id: true,
          attemptType: true,
          status: true,
          errorCode: true,
          errorMessageSafe: true,
          startedAt: true,
          finishedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.sportsResultConflict.findMany({
        where: { provider, providerEventId },
        orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
        take: 25,
        select: {
          id: true,
          storedResult: true,
          conflictingResult: true,
          detectedAt: true,
          acknowledgedAt: true,
        },
      }),
      this.prisma.betLeg.findMany({
        where: { provider, providerEventId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          betId: true,
          status: true,
          marketKey: true,
          selectionKey: true,
          eventStartTime: true,
          bet: { select: { status: true, stake: true, actualPayout: true } },
        },
      }),
    ]);
    return { provider, providerEventId, storedResult, attempts, conflicts, legs };
  }

  /**
   * Requests another authoritative provider result for one event and replays
   * settlement. Safe to repeat: settlement payouts are keyed by deterministic
   * ledger idempotency keys behind a per-bet advisory lock, so repeated
   * reconciliation can never pay twice.
   */
  async reconcile(actorId: string, provider: string, providerEventId: string) {
    await this.assertAdmin(actorId, 'EVENT_RECONCILIATION', providerEventId);
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'SPORTS_EVENT',
        targetId: providerEventId,
        action: 'ADMIN_EVENT_RECONCILIATION_REQUESTED',
        result: 'REQUESTED',
        metadata: { provider },
      },
    });
    this.logger.log({
      event: 'ADMIN_EVENT_RECONCILIATION_REQUESTED',
      provider,
      providerEventId,
    });
    const outcome = await this.settlement.reconcileEvent(provider, providerEventId);
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'SPORTS_EVENT',
        targetId: providerEventId,
        action: 'ADMIN_EVENT_RECONCILIATION_COMPLETED',
        result: outcome.status,
        metadata: {
          provider,
          resultStatus: 'resultStatus' in outcome ? outcome.resultStatus : null,
        },
      },
    });
    return { provider, providerEventId, ...outcome };
  }

  /**
   * Provider and worker health. Only whitelisted operational fields are
   * projected so credentials and connection strings can never surface.
   */
  async status(actorId: string) {
    await this.assertAdmin(actorId, 'PROVIDER_STATUS');
    const snapshot = await this.health.status();
    const config = sportsOperationsConfig();
    const provider: Record<string, string | undefined> = snapshot.provider ?? {};
    const worker: Record<string, string | undefined> = snapshot.worker ?? {};
    const numeric = (value: string | undefined) => {
      if (value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const remainingQuota = numeric(provider.remainingQuota);
    return {
      checkedAt: new Date().toISOString(),
      provider: {
        key: process.env.SPORTS_PROVIDER ?? 'the-odds-api',
        configured: Boolean(process.env.THE_ODDS_API_KEY),
        lastRequestAt: provider.lastRequestAt ?? null,
        lastSuccessAt: provider.lastSuccessAt ?? null,
        lastFailureAt: provider.lastFailureAt ?? null,
        lastErrorCode: provider.lastErrorCode || null,
        consecutiveFailures: numeric(provider.consecutiveFailures) ?? 0,
        remainingQuota,
        usedQuota: numeric(provider.usedQuota),
        lowQuota: remainingQuota !== null && remainingQuota <= config.lowQuotaThreshold,
      },
      settlementWorker: {
        enabled: config.settlementEnabled,
        pollSeconds: config.pollSeconds,
        lastStartedAt: worker.lastStartedAt ?? null,
        lastCompletedAt: worker.lastCompletedAt ?? null,
        lastStatus: worker.lastStatus ?? null,
        lastDurationMs: numeric(worker.lastDurationMs),
        eventsChecked: numeric(worker.eventsChecked),
        failures: numeric(worker.failures),
        consecutiveRunFailures: numeric(worker.consecutiveRunFailures) ?? 0,
      },
      cache: {
        healthy: snapshot.cacheHealthy,
        lastErrorAt:
          'lastCacheErrorAt' in snapshot ? snapshot.lastCacheErrorAt ?? null : null,
      },
    };
  }
}
