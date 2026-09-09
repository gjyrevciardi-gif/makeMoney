import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CasinoGameType, CasinoRoundStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CasinoRoundService } from './casino-round.service';

/**
 * Read-only administrative visibility over the casino.
 *
 * There is deliberately no method here that changes an outcome, a payout, a
 * mine position, or a round status. Administrators can observe and account for
 * the games; they cannot decide that a particular player wins or loses, and
 * they cannot see the hidden state of a round that is still in progress.
 */
@Injectable()
export class CasinoAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rounds: CasinoRoundService,
  ) {}

  private async assertAdmin(actorId: string, operation: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    });
    if (actor?.role === Role.ADMIN) return;
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_OPERATIONS',
        targetId: operation,
        action: 'PERMISSION_DENIED',
        result: 'DENIED',
        metadata: { operation },
      },
    });
    throw new ForbiddenException('ADMIN_REQUIRED');
  }

  /**
   * Round inspection. Uses exactly the same projection the owning player gets,
   * so an in-progress round does not leak its seed or hidden board to an
   * administrator either.
   */
  async listRounds(
    actorId: string,
    filters: {
      limit: number;
      gameType?: CasinoGameType;
      status?: CasinoRoundStatus;
      userId?: string;
    },
  ) {
    await this.assertAdmin(actorId, 'CASINO_ROUNDS');
    const rounds = await this.prisma.casinoRound.findMany({
      where: {
        gameType: filters.gameType,
        status: filters.status,
        userId: filters.userId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit,
      include: { user: { select: { id: true, email: true } } },
    });
    return {
      rounds: rounds.map((round) => ({
        ...this.rounds.publicView(round),
        player: round.user,
      })),
    };
  }

  /**
   * Platform-level casino analytics over a bounded window.
   *
   * Aggregated entirely in the database - a browser never receives raw rounds
   * to add up. Observed return is history, nothing more: no part of this system
   * feeds it back into future outcomes.
   */
  async analytics(actorId: string, period: '24H' | '7D' | '30D' | 'ALL') {
    await this.assertAdmin(actorId, 'CASINO_ANALYTICS');
    const hours = { '24H': 24, '7D': 24 * 7, '30D': 24 * 30, ALL: null }[period];
    const since = hours === null ? undefined : new Date(Date.now() - hours * 3_600_000);
    const where = since ? { createdAt: { gte: since } } : {};

    const [totals, byStatus, grouped, statusGrouped, activeRounds] = await Promise.all([
      this.prisma.casinoRound.aggregate({
        where,
        _sum: { stake: true, payout: true },
        _count: { _all: true },
      }),
      this.prisma.casinoRound.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.casinoRound.groupBy({
        by: ['gameType', 'gameVersion'],
        where,
        _sum: { stake: true, payout: true },
        _count: { _all: true },
      }),
      this.prisma.casinoRound.groupBy({
        by: ['gameType', 'gameVersion', 'status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.casinoRound.count({ where: { status: 'OPEN' } }),
    ]);

    const wagered = totals._sum.stake ?? 0n;
    const returned = totals._sum.payout ?? 0n;
    const ratio = (top: bigint, bottom: bigint) => (bottom > 0n
      ? new Prisma.Decimal(top.toString()).div(new Prisma.Decimal(bottom.toString())).toDecimalPlaces(6)
      : null);
    const observed = ratio(returned, wagered);
    const statusCount = (status: string) =>
      byStatus.find((row) => row.status === status)?._count._all ?? 0;

    const perVersionStatus = new Map<string, Record<string, number>>();
    for (const row of statusGrouped) {
      const key = `${row.gameType}:${row.gameVersion}`;
      const entry = perVersionStatus.get(key) ?? {};
      entry[row.status] = row._count._all;
      perVersionStatus.set(key, entry);
    }

    const games = grouped.map((row) => {
      const gameWagered = row._sum.stake ?? 0n;
      const gameReturned = row._sum.payout ?? 0n;
      const theoretical = Number(/\.rtp(\d+)$/.exec(row.gameVersion)?.[1] ?? NaN);
      const gameObserved = ratio(gameReturned, gameWagered);
      return {
        gameType: row.gameType,
        configVersion: row.gameVersion,
        theoreticalRtpBps: Number.isFinite(theoretical) ? theoretical : null,
        theoreticalRtpPercent: Number.isFinite(theoretical) ? (theoretical / 100).toFixed(2) : null,
        houseEdgeBps: Number.isFinite(theoretical) ? 10_000 - theoretical : null,
        houseEdgePercent: Number.isFinite(theoretical)
          ? ((10_000 - theoretical) / 100).toFixed(2)
          : null,
        rounds: row._count._all,
        statusCounts: perVersionStatus.get(`${row.gameType}:${row.gameVersion}`) ?? {},
        totalWagered: gameWagered.toString(),
        totalReturned: gameReturned.toString(),
        observedRtp: gameObserved ? gameObserved.toString() : null,
        observedRtpPercent: gameObserved ? gameObserved.mul(100).toFixed(2) : null,
        houseResult: (gameWagered - gameReturned).toString(),
      };
    });

    return {
      period,
      since: since?.toISOString() ?? null,
      totals: {
        totalRounds: totals._count._all,
        wins: statusCount('WON') + statusCount('CASHED_OUT'),
        losses: statusCount('LOST'),
        activeRounds,
        totalWagered: wagered.toString(),
        totalReturned: returned.toString(),
        houseResult: (wagered - returned).toString(),
        observedRtp: observed ? observed.toString() : null,
        observedRtpPercent: observed ? observed.mul(100).toFixed(2) : null,
      },
      games: games.sort((left, right) => left.configVersion.localeCompare(right.configVersion)),
      note: 'Observed return is historical variance only. Outcomes are never adjusted to steer it toward the theoretical value.',
    };
  }

  /**
   * A single player's operator view: wallet, recent ledger, sports bets and
   * casino rounds. Password and refresh-token hashes are never selected.
   */
  async userDetail(actorId: string, userId: string) {
    await this.assertAdmin(actorId, 'ADMIN_USER_DETAIL');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        wallet: { select: { id: true, balance: true, createdAt: true } },
      },
    });
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    const [ledger, bets, rounds] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { wallet: { userId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        select: {
          id: true, type: true, amount: true, reason: true,
          relatedBetId: true, relatedCasinoRoundId: true, createdAt: true,
        },
      }),
      this.prisma.bet.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true, type: true, status: true, stake: true,
          potentialPayout: true, actualPayout: true, createdAt: true,
        },
      }),
      this.prisma.casinoRound.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
    ]);
    return {
      user,
      ledger,
      sportsBets: bets,
      casinoRounds: rounds.map((round) => this.rounds.publicView(round)),
    };
  }

  /**
   * Theoretical versus observed return, grouped by game configuration version.
   *
   * The theoretical RTP is read back out of the version string that each round
   * recorded when it was played, so historical rows keep reporting the maths
   * that actually produced them even after configuration changes.
   *
   *   observedRtp  = total payouts / total stakes
   *   houseResult  = total stakes - total payouts   (positive favours the house)
   *
   * Divergence between observed and theoretical RTP is ordinary variance. No
   * part of this system feeds these numbers back into future outcomes.
   */
  async performance(actorId: string) {
    await this.assertAdmin(actorId, 'CASINO_PERFORMANCE');
    const [grouped, byStatus] = await Promise.all([
      this.prisma.casinoRound.groupBy({
        by: ['gameType', 'gameVersion'],
        _sum: { stake: true, payout: true },
        _count: { _all: true },
      }),
      this.prisma.casinoRound.groupBy({
        by: ['gameType', 'gameVersion', 'status'],
        _count: { _all: true },
      }),
    ]);

    const statusCounts = new Map<string, Record<string, number>>();
    for (const row of byStatus) {
      const key = `${row.gameType}:${row.gameVersion}`;
      const entry = statusCounts.get(key) ?? {};
      entry[row.status] = row._count._all;
      statusCounts.set(key, entry);
    }

    const games = grouped.map((row) => {
      const wagered = row._sum.stake ?? 0n;
      const returned = row._sum.payout ?? 0n;
      const theoreticalRtpBps = Number(/\.rtp(\d+)$/.exec(row.gameVersion)?.[1] ?? NaN);
      const observedRtp = wagered > 0n
        ? new Prisma.Decimal(returned.toString())
          .div(new Prisma.Decimal(wagered.toString()))
          .toDecimalPlaces(6)
        : null;
      return {
        gameType: row.gameType,
        configVersion: row.gameVersion,
        theoreticalRtpBps: Number.isFinite(theoreticalRtpBps) ? theoreticalRtpBps : null,
        theoreticalRtpPercent: Number.isFinite(theoreticalRtpBps)
          ? (theoreticalRtpBps / 100).toFixed(2)
          : null,
        houseEdgeBps: Number.isFinite(theoreticalRtpBps) ? 10_000 - theoreticalRtpBps : null,
        houseEdgePercent: Number.isFinite(theoreticalRtpBps)
          ? ((10_000 - theoreticalRtpBps) / 100).toFixed(2)
          : null,
        rounds: row._count._all,
        statusCounts: statusCounts.get(`${row.gameType}:${row.gameVersion}`) ?? {},
        totalWagered: wagered.toString(),
        totalReturned: returned.toString(),
        observedRtp: observedRtp ? observedRtp.toString() : null,
        observedRtpPercent: observedRtp ? observedRtp.mul(100).toFixed(2) : null,
        houseResult: (wagered - returned).toString(),
      };
    });

    const totalWagered = grouped.reduce((sum, row) => sum + (row._sum.stake ?? 0n), 0n);
    const totalReturned = grouped.reduce((sum, row) => sum + (row._sum.payout ?? 0n), 0n);
    return {
      games: games.sort((left, right) => left.configVersion.localeCompare(right.configVersion)),
      totals: {
        totalWagered: totalWagered.toString(),
        totalReturned: totalReturned.toString(),
        houseResult: (totalWagered - totalReturned).toString(),
        observedRtp: totalWagered > 0n
          ? new Prisma.Decimal(totalReturned.toString())
            .div(new Prisma.Decimal(totalWagered.toString()))
            .toDecimalPlaces(6)
            .toString()
          : null,
      },
      note: 'Observed return is historical variance only. Outcomes are never adjusted to steer it toward the theoretical value.',
    };
  }
}
