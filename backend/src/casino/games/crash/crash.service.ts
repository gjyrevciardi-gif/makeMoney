import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CasinoRound, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { CrashConfig, casinoConfig } from '../../casino.config';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoClock } from '../../casino-clock.service';
import { CasinoRoundService } from '../../casino-round.service';
import { CashoutCrashDto, StartCrashDto } from './crash.dto';
import {
  centiToDecimal,
  crashCurveCenti,
  crashDomain,
  crashElapsedMsToReach,
  crashPayout,
  deriveCrashPointCenti,
  resolveCrash,
} from './crash.engine';

type CrashPublicState = {
  startedAt: string;
  autoCashoutCenti: number | null;
  outcome: 'CASHED_OUT' | 'LOST' | null;
  automatic: boolean | null;
  cashoutCenti: number | null;
  /** Present only once the round is terminal; absent entirely while OPEN. */
  crashPointCenti?: number;
  config: { version: string; rtpBps: number; houseEdgeBps: number; tickMs: number };
};

type CrashPrivateState = { crashPointCenti: number };

/**
 * Server-authoritative Crash.
 *
 * The crash point is drawn once from the committed seed and lives only in
 * `privateState`, which the shared projection withholds until the round is
 * terminal. Progression is a pure function of server elapsed time, so a browser
 * can neither advance the curve nor claim a multiplier it did not reach.
 */
@Injectable()
export class CrashService {
  private readonly logger = new Logger(CrashService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rounds: CasinoRoundService,
    private readonly clock: CasinoClock,
    private readonly configs: CasinoConfigService,
  ) {}

  /** Overlays the operator's active version onto the built-in crash maths. */
  private shape(effective: {
    minStake: bigint; maxStake: bigint; rtpBps: number | null;
    gameSpecific: Record<string, unknown>; versionLabel: string;
  }): CrashConfig {
    const base = casinoConfig().crash;
    const rtpBps = effective.rtpBps ?? base.rtpBps;
    const integer = (value: unknown, fallback: number) =>
      Number.isInteger(value) ? (value as number) : fallback;
    return {
      ...base,
      minStake: effective.minStake,
      maxStake: effective.maxStake,
      rtpBps,
      houseEdgeBps: 10_000 - rtpBps,
      maxMultiplierCenti: integer(effective.gameSpecific.maxMultiplierCenti, base.maxMultiplierCenti),
      minAutoCashoutCenti: integer(effective.gameSpecific.minAutoCashoutCenti, base.minAutoCashoutCenti),
      maxAutoCashoutCenti: integer(effective.gameSpecific.maxAutoCashoutCenti, base.maxAutoCashoutCenti),
      version: effective.versionLabel,
    };
  }

  /** Mathematics for a NEW round. */
  private async config(): Promise<CrashConfig> {
    return this.shape(await this.configs.effective('crash'));
  }

  /**
   * Mathematics for a round already running, resolved from the version it
   * recorded. Activating a new configuration must never change the curve, the
   * cap, or the crash point of a round already in flight.
   */
  private async roundConfig(label: string): Promise<CrashConfig> {
    return this.shape(await this.configs.frozen('crash', label));
  }

  async publicConfig() {
    const config = await this.config();
    return {
      tickMs: config.tickMs,
      growthNumerator: config.growthNumerator,
      growthDenominator: config.growthDenominator,
      minMultiplier: centiToDecimal(config.minMultiplierCenti).toFixed(2),
      maxMultiplier: centiToDecimal(config.maxMultiplierCenti).toFixed(2),
      minAutoCashoutCenti: config.minAutoCashoutCenti,
      maxAutoCashoutCenti: config.maxAutoCashoutCenti,
      maxRoundMs: crashElapsedMsToReach(config.maxMultiplierCenti, config),
    };
  }

  private parsePublic(round: CasinoRound): CrashPublicState {
    const state = round.publicState as unknown as CrashPublicState;
    if (!state || typeof state.startedAt !== 'string') {
      throw new ConflictException({ code: 'ROUND_STATE_INVALID', message: 'Round state is unavailable.' });
    }
    return state;
  }

  private parsePrivate(round: CasinoRound): CrashPrivateState {
    const state = round.privateState as unknown as CrashPrivateState;
    if (!state || typeof state.crashPointCenti !== 'number') {
      throw new ConflictException({ code: 'ROUND_STATE_INVALID', message: 'Round state is unavailable.' });
    }
    return state;
  }

  /**
   * Adds the timing envelope a client needs to animate.
   *
   * `startedAt` plus `serverNow` let the browser mirror the same public curve
   * locally between requests, which is why it never has to poll: the numbers it
   * draws are derived from server timestamps, and the backend still decides
   * every settlement.
   */
  private async view(round: CasinoRound) {
    const base = this.rounds.publicView(round);
    const state = this.parsePublic(round);
    // Priced and timed from the round's own recorded version.
    const config = await this.roundConfig(round.gameVersion);
    const now = this.clock.nowMs();
    const startedAtMs = Date.parse(state.startedAt);
    const open = round.status === 'OPEN';
    const elapsedMs = Math.max(0, now - startedAtMs);
    const currentCenti = open
      ? crashCurveCenti(elapsedMs, config)
      : (state.cashoutCenti ?? state.crashPointCenti ?? config.minMultiplierCenti);
    return {
      ...base,
      timing: {
        startedAt: state.startedAt,
        serverNow: new Date(now).toISOString(),
        elapsedMs: open ? elapsedMs : null,
        tickMs: config.tickMs,
        growthNumerator: config.growthNumerator,
        growthDenominator: config.growthDenominator,
        maxMultiplier: centiToDecimal(config.maxMultiplierCenti).toFixed(2),
        currentMultiplier: centiToDecimal(currentCenti).toFixed(2),
      },
      crash: {
        autoCashout: state.autoCashoutCenti
          ? centiToDecimal(state.autoCashoutCenti).toFixed(2)
          : null,
        outcome: state.outcome,
        automatic: state.automatic,
        cashoutMultiplier: state.cashoutCenti
          ? centiToDecimal(state.cashoutCenti).toFixed(2)
          : null,
        // Only ever populated once the round is terminal.
        crashPoint: state.crashPointCenti
          ? centiToDecimal(state.crashPointCenti).toFixed(2)
          : null,
      },
    };
  }

  private assertAutoCashout(value: number | undefined, config: CrashConfig) {
    if (value === undefined) return null;
    if (value < config.minAutoCashoutCenti || value > config.maxAutoCashoutCenti) {
      throw new BadRequestException({
        code: 'INVALID_AUTO_CASHOUT',
        message: 'Auto cashout is outside the allowed range.',
      });
    }
    return value;
  }

  async start(userId: string, input: StartCrashDto) {
    await this.configs.assertPlayable('crash');
    const config = await this.config();
    const stake = this.rounds.assertStake(input.stake, config);
    const autoCashoutCenti = this.assertAutoCashout(input.autoCashoutCenti, config);

    const existingOpen = await this.prisma.casinoRound.findFirst({
      where: { userId, gameType: 'CRASH', status: 'OPEN' },
    });
    if (existingOpen && existingOpen.idempotencyKey !== input.idempotencyKey) {
      throw new ConflictException({
        code: 'ROUND_ALREADY_OPEN',
        message: 'Finish your current round first.',
      });
    }

    const prepared = this.rounds.prepare(input.clientSeed, crashDomain(config));
    const crashPointCenti = deriveCrashPointCenti(prepared.fairness, config);
    const startedAt = this.clock.now();

    // A crash point at the floor can never be beaten, because the curve already
    // equals it at t = 0. Those rounds settle immediately rather than pretending
    // to run. This is where the configured house edge shows up.
    const instantBust = crashPointCenti <= config.minMultiplierCenti;

    const publicState: CrashPublicState = {
      startedAt: startedAt.toISOString(),
      autoCashoutCenti,
      outcome: instantBust ? 'LOST' : null,
      automatic: instantBust ? true : null,
      cashoutCenti: null,
      // The crash point is not merely blanked while the round runs: the key is
      // absent, so a future field can never leak it by being serialised.
      ...(instantBust ? { crashPointCenti } : {}),
      config: {
        version: config.version,
        rtpBps: config.rtpBps,
        houseEdgeBps: config.houseEdgeBps,
        tickMs: config.tickMs,
      },
    };

    const round = await this.rounds.openRound({
      userId,
      gameId: 'crash',
      gameType: 'CRASH',
      gameVersion: config.version,
      stake,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: 'Casino crash stake',
      outcome: {
        status: instantBust ? 'LOST' : 'OPEN',
        multiplier: instantBust ? new Prisma.Decimal(0) : null,
        payout: 0n,
        publicState: publicState as unknown as Prisma.InputJsonValue,
        privateState: { crashPointCenti },
      },
    });

    this.logger.log({
      event: instantBust ? 'CASINO_ROUND_LOST' : 'CASINO_ROUND_STARTED',
      gameType: 'CRASH',
      roundId: round.id,
    });
    return this.view(round);
  }

  /**
   * Applies the authoritative terminal decision for a round, if it is due.
   *
   * Shared by the cashout endpoint, the recovery endpoint and the background
   * worker so that all three reach the identical result for a given server
   * instant. The conditional status update is the exactly-once guard: only one
   * caller can move the round out of OPEN, and the deterministic ledger key
   * would refuse a second credit even if one did.
   */
  private async settle(
    roundId: string,
    options: { userId?: string; manual?: boolean; actionKey?: string } = {},
  ): Promise<CasinoRound> {
    // The frozen configuration is resolved before the transaction opens.
    // Querying it inside would need a second pooled connection while this one
    // already holds the round's advisory lock, which deadlocks the pool as soon
    // as concurrent cashouts fill it. The recorded version never changes, so
    // reading it outside is equivalent and safe.
    const existing = await this.prisma.casinoRound.findFirst({
      where: { id: roundId, ...(options.userId ? { userId: options.userId } : {}) },
      select: { gameVersion: true },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    }
    const config = await this.roundConfig(existing.gameVersion);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roundId}))`;

      if (options.actionKey) {
        const replay = await tx.casinoRoundAction.findUnique({
          where: { idempotencyKey: options.actionKey },
        });
        if (replay) {
          if (replay.roundId !== roundId
            || (options.userId && replay.userId !== options.userId)) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_CONFLICT',
              message: 'This request identifier is already in use.',
            });
          }
          return tx.casinoRound.findFirstOrThrow({ where: { id: roundId } });
        }
      }

      const round = await tx.casinoRound.findFirst({
        where: { id: roundId, ...(options.userId ? { userId: options.userId } : {}) },
      });
      if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
      if (round.status !== 'OPEN') {
        if (options.manual) {
          throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
        }
        return round;
      }

      const publicState = this.parsePublic(round);
      const { crashPointCenti } = this.parsePrivate(round);
      const elapsedMs = this.clock.nowMs() - Date.parse(publicState.startedAt);
      const resolution = resolveCrash({
        elapsedMs,
        crashPointCenti,
        autoCashoutCenti: publicState.autoCashoutCenti,
        config,
      });

      // A manual cashout that arrives while the round is still running settles
      // at the authoritative current multiplier. An automatic outcome that is
      // already due takes precedence, because it happened earlier in server time.
      const decision = resolution.terminal
        ? resolution
        : options.manual
          ? {
            terminal: true as const,
            outcome: 'CASHED_OUT' as const,
            atCenti: resolution.currentCenti,
            automatic: false,
            currentCenti: resolution.currentCenti,
          }
          : null;

      if (!decision) return round;

      if (options.actionKey) {
        await tx.casinoRoundAction.create({
          data: {
            roundId,
            userId: round.userId,
            action: decision.outcome === 'CASHED_OUT' ? 'CASHOUT' : 'CRASH_LOST',
            payload: { atCenti: decision.atCenti, automatic: decision.automatic },
            idempotencyKey: options.actionKey,
          },
        });
      }

      const won = decision.outcome === 'CASHED_OUT';
      const payout = won ? crashPayout(round.stake, decision.atCenti) : 0n;
      this.rounds.assertPayoutFits(payout);

      const settledPublic: CrashPublicState = {
        ...publicState,
        outcome: decision.outcome,
        automatic: decision.automatic,
        cashoutCenti: won ? decision.atCenti : null,
        // The crash point becomes public only now that the round is terminal.
        crashPointCenti,
      };

      const updated = await tx.casinoRound.updateMany({
        where: { id: roundId, status: 'OPEN' },
        data: {
          status: won ? 'CASHED_OUT' : 'LOST',
          multiplier: won ? centiToDecimal(decision.atCenti) : new Prisma.Decimal(0),
          payout,
          settledAt: new Date(),
          publicState: settledPublic as unknown as Prisma.InputJsonValue,
        },
      });
      if (updated.count !== 1) {
        if (options.manual) {
          throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
        }
        return tx.casinoRound.findFirstOrThrow({ where: { id: roundId } });
      }

      if (payout > 0n) {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: round.userId } });
        await this.rounds.creditWin(tx, roundId, round.userId, wallet.id, payout);
      }

      await tx.auditLog.create({
        data: {
          actorId: round.userId,
          targetType: 'CASINO_ROUND',
          targetId: roundId,
          action: won ? 'CASINO_CASHOUT' : 'CASINO_ROUND_LOST',
          result: decision.outcome,
          metadata: {
            gameType: 'CRASH',
            automatic: decision.automatic,
            multiplier: centiToDecimal(decision.atCenti).toFixed(2),
            payout: payout.toString(),
          },
        },
      });

      return tx.casinoRound.findFirstOrThrow({ where: { id: roundId } });
    }, { maxWait: 10_000, timeout: 20_000 });
  }

  async cashout(userId: string, roundId: string, input: CashoutCrashDto) {
    const settled = await this.settle(roundId, {
      userId,
      manual: true,
      actionKey: input.idempotencyKey,
    });
    this.logger.log({ event: 'CASINO_ROUND_SETTLED', gameType: 'CRASH', roundId });
    return this.view(settled);
  }

  /**
   * The active round for refresh and reconnect.
   *
   * Resolves any outcome that became due while the player was away before
   * returning, so a reconnecting client never sees a round that the server
   * clock says has already finished.
   */
  async active(userId: string) {
    const open = await this.prisma.casinoRound.findFirst({
      where: { userId, gameType: 'CRASH', status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });
    if (!open) return null;
    const current = await this.settle(open.id, { userId });
    return this.view(current);
  }

  /**
   * Background sweep: settles every OPEN round whose authoritative curve has
   * already reached its auto-cashout or its crash point. This is what makes a
   * disconnected round terminate without the browser ever coming back.
   */
  async settleDue(limit = 200) {
    const open = await this.prisma.casinoRound.findMany({
      where: { gameType: 'CRASH', status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let settled = 0;
    for (const round of open) {
      try {
        const result = await this.settle(round.id);
        if (result.status !== 'OPEN') settled += 1;
      } catch {
        this.logger.warn({ event: 'CASINO_ROUND_FAILED', gameType: 'CRASH', roundId: round.id });
      }
    }
    return { scanned: open.length, settled };
  }
}
