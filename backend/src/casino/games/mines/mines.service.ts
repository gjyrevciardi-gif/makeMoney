import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CasinoRound, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { MinesConfig, casinoConfig } from '../../casino.config';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoRoundService } from '../../casino-round.service';
import {
  minesBoard,
  minesDomain,
  minesLadder,
  minesMaxSafeCells,
  minesMultiplier,
  minesPayout,
  minesSurvivalProbability,
} from './mines.engine';
import { CashoutMinesDto, RevealMinesDto, StartMinesDto } from './mines.dto';

type MinesPublicState = {
  cells: number;
  mines: number;
  revealed: number[];
  hitCell: number | null;
  config: { version: string; rtpBps: number; houseEdgeBps: number };
};

type MinesPrivateState = { minePositions: number[] };

/**
 * Server-authoritative Mines.
 *
 * Mine positions are drawn once from the committed server seed when the round
 * opens and live only in `privateState`, which is never projected while the
 * round is OPEN. The client sends a cell index; whether that cell is safe is
 * decided here and nowhere else.
 */
@Injectable()
export class MinesService {
  private readonly logger = new Logger(MinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rounds: CasinoRoundService,
    private readonly configs: CasinoConfigService,
  ) {}

  /** Overlays the operator's active version onto the built-in mines maths. */
  private shape(effective: {
    minStake: bigint; maxStake: bigint; rtpBps: number | null;
    gameSpecific: Record<string, unknown>; versionLabel: string;
  }): MinesConfig {
    const base = casinoConfig().mines;
    const rtpBps = effective.rtpBps ?? base.rtpBps;
    const allowed = Array.isArray(effective.gameSpecific.allowedMines)
      ? (effective.gameSpecific.allowedMines as number[])
      : null;
    return {
      ...base,
      minStake: effective.minStake,
      maxStake: effective.maxStake,
      rtpBps,
      houseEdgeBps: 10_000 - rtpBps,
      minMines: allowed && allowed.length ? Math.min(...allowed) : base.minMines,
      maxMines: allowed && allowed.length ? Math.max(...allowed) : base.maxMines,
      version: effective.versionLabel,
    };
  }

  /** Mathematics for a NEW round. */
  private async config(): Promise<MinesConfig> {
    return this.shape(await this.configs.effective('mines'));
  }

  /**
   * Mathematics for an EXISTING round, resolved from the version the round
   * recorded. An operator activating a new version must never reprice a ladder
   * a player is already climbing.
   */
  private async roundConfig(round: CasinoRound): Promise<MinesConfig> {
    return this.shape(await this.configs.frozen('mines', round.gameVersion));
  }

  /** The set of mine counts the active configuration permits. */
  private async allowedMines(): Promise<number[]> {
    const effective = await this.configs.effective('mines');
    const allowed = Array.isArray(effective.gameSpecific.allowedMines)
      ? (effective.gameSpecific.allowedMines as number[])
      : null;
    if (allowed && allowed.length) return [...allowed].sort((a, b) => a - b);
    const base = casinoConfig().mines;
    return Array.from({ length: base.maxMines - base.minMines + 1 }, (_, i) => base.minMines + i);
  }

  async publicConfig() {
    const config = await this.config();
    const allowed = await this.allowedMines();
    return {
      cells: config.cells,
      minMines: config.minMines,
      maxMines: config.maxMines,
      ladders: Object.fromEntries(
        Array.from({ length: config.maxMines - config.minMines + 1 }, (_, index) => {
          const mines = config.minMines + index;
          return [mines, minesLadder(config, mines)];
        }),
      ),
    };
  }

  private parsePublic(round: CasinoRound): MinesPublicState {
    const state = round.publicState as unknown as MinesPublicState;
    if (!state || !Array.isArray(state.revealed) || typeof state.mines !== 'number') {
      throw new ConflictException({ code: 'ROUND_STATE_INVALID', message: 'Round state is unavailable.' });
    }
    return state;
  }

  private parsePrivate(round: CasinoRound): MinesPrivateState {
    const state = round.privateState as unknown as MinesPrivateState;
    if (!state || !Array.isArray(state.minePositions)) {
      throw new ConflictException({ code: 'ROUND_STATE_INVALID', message: 'Round state is unavailable.' });
    }
    return state;
  }

  /**
   * Adds the derived, non-secret progress fields the UI needs.
   *
   * Priced from the round's own recorded version, never the active one.
   */
  private async view(round: CasinoRound) {
    const base = this.rounds.publicView(round);
    const state = this.parsePublic(round);
    const config = await this.roundConfig(round);
    const revealed = state.revealed.length;
    const maxSafe = minesMaxSafeCells(config, state.mines);
    const current = revealed > 0
      ? minesMultiplier(config, state.mines, revealed)
      : null;
    const next = revealed < maxSafe
      ? minesMultiplier(config, state.mines, revealed + 1)
      : null;
    return {
      ...base,
      progress: {
        revealedCount: revealed,
        maxSafeCells: maxSafe,
        currentMultiplier: current ? current.toString() : null,
        potentialPayout: current ? minesPayout(round.stake, current).toString() : '0',
        nextMultiplier: next ? next.toString() : null,
        nextPayout: next ? minesPayout(round.stake, next).toString() : null,
        canCashout: round.status === 'OPEN' && revealed > 0,
      },
    };
  }

  private assertMines(mines: number, config: MinesConfig, allowed?: number[]) {
    if (allowed && !allowed.includes(mines)) {
      throw new BadRequestException({
        code: 'INVALID_MINE_COUNT',
        message: `Mine count must be one of ${allowed.join(', ')}.`,
      });
    }
    if (mines < config.minMines || mines > config.maxMines) {
      throw new BadRequestException({
        code: 'INVALID_MINE_COUNT',
        message: `Mine count must be between ${config.minMines} and ${config.maxMines}.`,
      });
    }
  }

  async start(userId: string, input: StartMinesDto) {
    await this.configs.assertPlayable('mines');
    const config = await this.config();
    const allowed = await this.allowedMines();
    const stake = this.rounds.assertStake(input.stake, config);
    this.assertMines(input.mines, config, allowed);

    const existingOpen = await this.prisma.casinoRound.findFirst({
      where: { userId, gameType: 'MINES', status: 'OPEN' },
    });
    if (existingOpen && existingOpen.idempotencyKey !== input.idempotencyKey) {
      throw new ConflictException({
        code: 'ROUND_ALREADY_OPEN',
        message: 'Finish or cash out your current game first.',
      });
    }

    const prepared = this.rounds.prepare(input.clientSeed, minesDomain(config));
    const minePositions = minesBoard(prepared.fairness, config, input.mines);

    const round = await this.rounds.openRound({
      userId,
      gameId: 'mines',
      gameType: 'MINES',
      gameVersion: config.version,
      stake,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: 'Casino mines stake',
      outcome: {
        status: 'OPEN',
        multiplier: null,
        payout: 0n,
        publicState: {
          cells: config.cells,
          mines: input.mines,
          revealed: [],
          hitCell: null,
          config: {
            version: config.version,
            rtpBps: config.rtpBps,
            houseEdgeBps: config.houseEdgeBps,
          },
        },
        // Hidden until the round is terminal.
        privateState: { minePositions },
      },
    });
    return this.view(round);
  }

  /** The active round for refresh recovery. Returns null rather than 404 when idle. */
  async active(userId: string) {
    const round = await this.prisma.casinoRound.findFirst({
      where: { userId, gameType: 'MINES', status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });
    return round ? this.view(round) : null;
  }

  /**
   * Reveals one cell.
   *
   * A transaction-scoped advisory lock serialises concurrent actions on the
   * same round, and the recorded action key makes a retried request a replay
   * instead of a second reveal.
   */
  async reveal(userId: string, roundId: string, input: RevealMinesDto) {
    // Deliberately no availability gate: a stake is already committed, so an
    // in-flight round must always be finishable even under maintenance.
    const opened = await this.prisma.casinoRound.findFirst({ where: { id: roundId, userId } });
    if (!opened) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    const config = await this.roundConfig(opened);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roundId}))`;

      const replay = await tx.casinoRoundAction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay) {
        if (replay.roundId !== roundId || replay.userId !== userId) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'This request identifier is already in use.' });
        }
        const current = await tx.casinoRound.findFirstOrThrow({ where: { id: roundId, userId } });
        return { round: current, replayed: true };
      }

      const round = await tx.casinoRound.findFirst({ where: { id: roundId, userId } });
      if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
      if (round.status !== 'OPEN') {
        throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
      }

      const publicState = this.parsePublic(round);
      const { minePositions } = this.parsePrivate(round);
      if (input.cell >= publicState.cells) {
        throw new BadRequestException({ code: 'INVALID_CELL', message: 'That cell is not on the board.' });
      }
      if (publicState.revealed.includes(input.cell)) {
        throw new ConflictException({ code: 'CELL_ALREADY_REVEALED', message: 'That cell is already revealed.' });
      }

      await tx.casinoRoundAction.create({
        data: {
          roundId,
          userId,
          action: 'REVEAL',
          payload: { cell: input.cell },
          idempotencyKey: input.idempotencyKey,
        },
      });

      const struckMine = minePositions.includes(input.cell);
      const revealed = struckMine ? publicState.revealed : [...publicState.revealed, input.cell];
      const maxSafe = minesMaxSafeCells(config, publicState.mines);
      const cleared = !struckMine && revealed.length === maxSafe;

      if (struckMine) {
        const updated = await tx.casinoRound.updateMany({
          where: { id: roundId, status: 'OPEN' },
          data: {
            status: 'LOST',
            multiplier: new Prisma.Decimal(0),
            payout: 0n,
            settledAt: new Date(),
            publicState: { ...publicState, revealed, hitCell: input.cell },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
        }
        await tx.auditLog.create({
          data: {
            actorId: userId,
            targetType: 'CASINO_ROUND',
            targetId: roundId,
            action: 'CASINO_ROUND_LOST',
            result: 'LOST',
            metadata: { gameType: 'MINES', cell: input.cell, revealedCount: revealed.length },
          },
        });
      } else if (cleared) {
        // Every safe cell is open: the round wins at the top of the ladder.
        const multiplier = minesMultiplier(config, publicState.mines, revealed.length);
        const payout = minesPayout(round.stake, multiplier);
        this.rounds.assertPayoutFits(payout);
        const updated = await tx.casinoRound.updateMany({
          where: { id: roundId, status: 'OPEN' },
          data: {
            status: 'WON',
            multiplier,
            payout,
            settledAt: new Date(),
            publicState: { ...publicState, revealed, hitCell: null },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
        }
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
        await this.rounds.creditWin(tx, roundId, userId, wallet.id, payout);
        await tx.auditLog.create({
          data: {
            actorId: userId,
            targetType: 'CASINO_ROUND',
            targetId: roundId,
            action: 'CASINO_ROUND_WON',
            result: 'WON',
            metadata: {
              gameType: 'MINES',
              multiplier: multiplier.toString(),
              payout: payout.toString(),
            },
          },
        });
      } else {
        const updated = await tx.casinoRound.updateMany({
          where: { id: roundId, status: 'OPEN' },
          data: { publicState: { ...publicState, revealed, hitCell: null } },
        });
        if (updated.count !== 1) {
          throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
        }
      }

      const refreshed = await tx.casinoRound.findFirstOrThrow({ where: { id: roundId, userId } });
      return { round: refreshed, replayed: false };
    }, { maxWait: 10_000, timeout: 20_000 });

    return this.view(result.round);
  }

  /**
   * Cashes out at the authoritative current multiplier.
   *
   * The conditional status update is the exactly-once guard: only one
   * concurrent request can move the round out of OPEN, and the deterministic
   * ledger key would reject a second credit even if one did.
   */
  async cashout(userId: string, roundId: string, input: CashoutMinesDto) {
    const opened = await this.prisma.casinoRound.findFirst({ where: { id: roundId, userId } });
    if (!opened) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    const config = await this.roundConfig(opened);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roundId}))`;

      const replay = await tx.casinoRoundAction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay) {
        if (replay.roundId !== roundId || replay.userId !== userId) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'This request identifier is already in use.' });
        }
        return tx.casinoRound.findFirstOrThrow({ where: { id: roundId, userId } });
      }

      const round = await tx.casinoRound.findFirst({ where: { id: roundId, userId } });
      if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
      if (round.status !== 'OPEN') {
        throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
      }

      const publicState = this.parsePublic(round);
      if (publicState.revealed.length === 0) {
        throw new ConflictException({
          code: 'NOTHING_REVEALED',
          message: 'Reveal at least one cell before cashing out.',
        });
      }

      await tx.casinoRoundAction.create({
        data: {
          roundId,
          userId,
          action: 'CASHOUT',
          payload: { revealedCount: publicState.revealed.length },
          idempotencyKey: input.idempotencyKey,
        },
      });

      const multiplier = minesMultiplier(config, publicState.mines, publicState.revealed.length);
      const payout = minesPayout(round.stake, multiplier);
      this.rounds.assertPayoutFits(payout);

      const updated = await tx.casinoRound.updateMany({
        where: { id: roundId, status: 'OPEN' },
        data: { status: 'CASHED_OUT', multiplier, payout, settledAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This round is already finished.' });
      }

      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      await this.rounds.creditWin(tx, roundId, userId, wallet.id, payout);
      await tx.auditLog.create({
        data: {
          actorId: userId,
          targetType: 'CASINO_ROUND',
          targetId: roundId,
          action: 'CASINO_CASHOUT',
          result: 'CASHED_OUT',
          metadata: {
            gameType: 'MINES',
            multiplier: multiplier.toString(),
            payout: payout.toString(),
            revealedCount: publicState.revealed.length,
          },
        },
      });
      return tx.casinoRound.findFirstOrThrow({ where: { id: roundId, userId } });
    }, { maxWait: 10_000, timeout: 20_000 });

    this.logger.log({ event: 'CASINO_CASHOUT', gameType: 'MINES', roundId });
    return this.view(result);
  }

  /** Survival odds for the UI; derived from public configuration only. */
  async odds(mines: number, revealed: number) {
    const config = await this.config();
    this.assertMines(mines, config);
    return {
      survivalProbability: minesSurvivalProbability(config, mines, revealed).toString(),
      multiplier: revealed > 0 ? minesMultiplier(config, mines, revealed).toString() : null,
    };
  }
}
