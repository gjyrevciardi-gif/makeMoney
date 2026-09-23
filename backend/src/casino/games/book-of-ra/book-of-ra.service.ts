import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { BookOfRaSession, CasinoRound, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { FeatureState } from '@slot-skills/features';
import { CryptoRngProvider, type RngProvider, type Win } from '@slot-skills/math';
import {
  bookOfRaPresentation,
  createBookOfRaState,
  fromFeatureState,
  hasPendingBookOfRaAction,
  playBookOfRaRound,
  resolveBookOfRaGamble,
  toFeatureState,
  type BookOfRaGambleChoice,
  type BookOfRaGameState,
  type PendingAction,
} from '@slot-skills/runtime';
import { canonicalJson } from '@slot-skills/schema';
import { PrismaService } from '../../../prisma.service';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoFairnessService } from '../../casino-fairness.service';
import { CasinoGameRegistry } from '../../casino-game.registry';
import {
  BOOK_ACTIVE_LINES,
  BOOK_ENGINE_GAME_ID,
  BOOK_GAME,
  BOOK_GAME_ID,
  BOOK_GAME_VERSION,
  BOOK_PROFILE_FINGERPRINT,
  BOOK_PROFILE_ID,
  publicBookOfRaConfig,
  validateBookOfRaEngine,
} from './book-of-ra.definition';
import { SpinBookOfRaDto, BookOfRaActionDto } from './book-of-ra.dto';

type WinView = {
  evaluator: string;
  symbolId: string;
  count: number;
  ways: number;
  cells: Array<{ reel: number; row: number }>;
  amount: string;
};

export type BookOfRaRoundView = {
  gameId: string;
  gameType: 'SLOTS';
  profileId: string;
  profileFingerprint: string;
  roundId: string | null;
  roundState: string;
  board: string[][] | null;
  wins: WinView[];
  winTotal: string;
  expandingReels: number[];
  expandingWin: string;
  specialSymbol: string | null;
  betPerLine: string;
  totalBet: string;
  activeLines: number;
  stakeLocked: boolean;
  freeSpinsAwarded: number;
  freeSpinsRemaining: number;
  freeSpinsPlayed: number;
  featureWin: string;
  pendingWin: string;
  gambleAttempts: number;
  gambleMaxAttempts: number;
  pendingAction: PendingAction | null;
  settlement: { wager: string; payout: string; settled: boolean };
  balance: string | null;
  idempotent: boolean;
};

/**
 * Server-authoritative Book of the Sands.
 *
 * The service owns the *platform* half of a round: authenticated identity,
 * stake limits, the atomic wallet debit, the immutable ledger entry, the round
 * row, the scoped idempotency record and the session that carries free games
 * and a pending gamble across requests. It owns none of the *game*: the board,
 * the paylines, the expanding symbol, the retriggers and the gamble colours all
 * come from the frozen profile in `@slot-skills`, so the same code that plays a
 * simulated round plays the round a player receives.
 *
 * Guarantees:
 * - no request may supply an outcome, a board, an expanding symbol, a payout,
 *   a user id or a line count; the DTOs reject unknown fields outright;
 * - the production RNG is Node's CSPRNG and cannot be replaced outside tests;
 * - one round is one transaction: debit, credit, round, ledger entries, session
 *   and idempotency record commit together or not at all;
 * - a pending gamble blocks a new paid round, and the win it holds is not
 *   credited until the ladder resolves;
 * - idempotency keys are scoped to player, game and operation and bound to a
 *   fingerprint of the request body.
 */
@Injectable()
export class BookOfRaService implements OnModuleInit {
  private readonly logger = new Logger(BookOfRaService.name);
  private rngFactory: () => RngProvider = () => new CryptoRngProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CasinoGameRegistry,
    private readonly configs: CasinoConfigService,
    private readonly fairness: CasinoFairnessService,
  ) {}

  onModuleInit(): void {
    validateBookOfRaEngine();
    this.logger.log({
      event: 'BOOK_OF_RA_PROFILE_VALIDATED',
      profileId: BOOK_PROFILE_ID,
      profileFingerprint: BOOK_PROFILE_FINGERPRINT,
      activeLines: BOOK_ACTIVE_LINES,
      rtpBps: 5_000,
    });
  }

  /**
   * Test-only seam.
   *
   * The production request path never accepts an RNG, a seed or an outcome: it
   * always draws from Node's CSPRNG. This method exists so tests and the
   * simulator can pin a deterministic stream, and it refuses to install one in
   * anything but a test process.
   */
  useTestRngFactory(factory: () => RngProvider): void {
    if ((process.env.NODE_ENV ?? '') !== 'test') {
      throw new Error('A deterministic RNG may only be installed in tests');
    }
    this.rngFactory = factory;
  }

  async config() {
    const effective = await this.configs.effective(BOOK_GAME_ID);
    return publicBookOfRaConfig({
      minStake: effective.minStake,
      maxStake: effective.maxStake,
    });
  }

  /**
   * Refresh projection.
   *
   * It rebuilds everything a returning client needs from stored state and never
   * re-rolls an outcome or re-settles a win.
   */
  async state(userId: string): Promise<BookOfRaRoundView> {
    const session = await this.prisma.bookOfRaSession.findUnique({ where: { userId } });
    const round = session?.pendingRoundId
      ? await this.prisma.casinoRound.findFirst({ where: { id: session.pendingRoundId, userId } })
      : null;
    const state = this.stateFromSession(session, 0n);
    return this.view({
      state,
      roundId: session?.pendingRoundId ?? null,
      // A refresh moves no money: the locked stake is reported in `totalBet`.
      wager: 0n,
      payout: round?.payout ?? 0n,
      settled: round ? round.settledAt !== null : true,
      balance: null,
      idempotent: false,
    });
  }

  /** Opens one paid spin, or continues an active free-game sequence. */
  async spin(userId: string, dto: SpinBookOfRaDto): Promise<BookOfRaRoundView> {
    return this.runIdempotent(
      userId,
      'spin',
      dto.idempotencyKey,
      { betPerLine: dto.betPerLine, autoplay: dto.autoplay === true, clientSeed: dto.clientSeed ?? null },
      (fingerprint) => this.spinTransaction(userId, dto, fingerprint),
    );
  }

  private async spinTransaction(userId: string, dto: SpinBookOfRaDto, fingerprint: string): Promise<BookOfRaRoundView> {
    const profileFingerprint = BOOK_PROFILE_FINGERPRINT;

    return this.prisma.$transaction(async (tx) => {
      const session = await this.lockSession(tx, userId);
      const replay = await this.replay(tx, userId, 'spin', dto.idempotencyKey, fingerprint);
      if (replay) return { ...replay, idempotent: true };

      const state = this.stateFromSession(session, BigInt(dto.betPerLine));
      this.assertStateUsable(state);
      const freeGame = state.freeSpinsRemaining > 0;
      // Admission controls apply only to new wagers, never persisted obligations.
      if (!freeGame) await this.configs.assertPlayable(BOOK_GAME_ID);
      if (hasPendingBookOfRaAction(state)) {
        throw new ConflictException({
          code: 'ACTION_PENDING',
          message: 'Resolve the pending gamble before starting another spin.',
        });
      }

      const effective = freeGame ? null : await this.configs.effective(BOOK_GAME_ID);
      const maxBetPerLine = effective ? effective.maxStake / BigInt(BOOK_ACTIVE_LINES) : 0n;
      const betPerLine = freeGame ? BigInt(state.betPerLine) : BigInt(dto.betPerLine);
      if (betPerLine < 1n) {
        throw new BadRequestException({ code: 'INVALID_STAKE', message: 'The bet per line must be a whole positive number of points.' });
      }
      if (!freeGame && betPerLine > maxBetPerLine) {
        throw new BadRequestException({
          code: 'STAKE_ABOVE_MAXIMUM',
          message: `The maximum bet per line is ${maxBetPerLine} points.`,
        });
      }
      const cost = freeGame ? 0n : betPerLine * BigInt(BOOK_ACTIVE_LINES);
      if (effective && cost < effective.minStake) {
        throw new BadRequestException({
          code: 'STAKE_BELOW_MINIMUM',
          message: `The minimum total bet is ${effective.minStake} points.`,
        });
      }
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'This account has no wallet.' });
      if (cost > 0n) await this.debit(tx, wallet.id, cost);

      const commitment = this.fairness.createCommitment();
      const roundId = randomUUID();
      const played = await playBookOfRaRound({
        game: BOOK_GAME,
        state,
        rng: this.rngFactory(),
        roundId,
        betPerLine,
        activeLines: BOOK_ACTIVE_LINES,
        autoplay: dto.autoplay === true,
      });
      const outcome = played.outcome;
      // A gamble withholds its win: the credit happens when the ladder
      // resolves, so the round can never pay twice for one spin.
      const payout = outcome.pendingAction ? 0n : BigInt(outcome.totalSpinWin);
      const settled = !outcome.pendingAction;

      const round = await tx.casinoRound.create({
        data: {
          id: roundId,
          userId,
          gameType: 'SLOTS',
          gameVersion: BOOK_GAME_VERSION,
          status: outcome.pendingAction ? 'OPEN' : payout > 0n ? 'WON' : 'LOST',
          stake: cost,
          multiplier: payout > 0n && cost > 0n ? new Prisma.Decimal(payout.toString()).div(cost.toString()) : null,
          payout,
          serverSeed: commitment.serverSeed,
          serverSeedHash: commitment.serverSeedHash,
          clientSeed: this.fairness.normalizeClientSeed(dto.clientSeed, roundId),
          nonce: 0,
          publicState: this.publicState(played.state, outcome, payout, settled),
          privateState: this.privateState(played.state, outcome, played.draws),
          idempotencyKey: this.roundKey(userId, 'spin', dto.idempotencyKey),
          settledAt: settled ? new Date() : null,
        },
      });

      if (cost > 0n) await this.ledgerDebit(tx, wallet.id, userId, round.id, cost);
      if (payout > 0n) await this.ledgerCredit(tx, wallet.id, round.id, userId, payout);
      await this.writeSession(tx, userId, played.state);
      const balance = (await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance;
      const response = this.view({
        state: played.state,
        roundId: round.id,
        wager: cost,
        payout,
        settled,
        balance,
        idempotent: false,
      });
      await this.rememberRequest(tx, userId, 'spin', dto.idempotencyKey, fingerprint, round.id, response);
      await this.audit(tx, userId, round.id, outcome.pendingAction
        ? 'CASINO_ROUND_STARTED'
        : payout > 0n ? 'CASINO_ROUND_WON' : 'CASINO_ROUND_LOST', {
        profileId: BOOK_PROFILE_ID,
        profileFingerprint,
        betPerLine: betPerLine.toString(),
        totalBet: cost > 0n ? cost.toString() : played.state.totalBet,
        payout: payout.toString(),
        freeSpin: outcome.freeSpin,
        pendingAction: outcome.pendingAction?.id ?? null,
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 20_000 });
  }

  /** Resolves the single pending action of a round (the red/black gamble). */
  async act(userId: string, dto: BookOfRaActionDto): Promise<BookOfRaRoundView> {
    return this.runIdempotent(
      userId,
      'action',
      dto.idempotencyKey,
      { roundId: dto.roundId, actionId: dto.actionId, choiceId: dto.choiceId },
      (fingerprint) => this.actTransaction(userId, dto, fingerprint),
    );
  }

  private async actTransaction(userId: string, dto: BookOfRaActionDto, fingerprint: string): Promise<BookOfRaRoundView> {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.lockSession(tx, userId);
      const replay = await this.replay(tx, userId, 'action', dto.idempotencyKey, fingerprint);
      if (replay) return { ...replay, idempotent: true };

      const round = await tx.casinoRound.findFirst({ where: { id: dto.roundId, userId } });
      if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
      if (round.settledAt !== null) {
        throw new ConflictException({ code: 'ROUND_ALREADY_SETTLED', message: 'This round is already settled.' });
      }
      if (!session.pendingRoundId || session.pendingRoundId !== round.id) {
        throw new ConflictException({ code: 'NO_PENDING_ACTION', message: 'This round has no pending action.' });
      }
      const state = this.stateFromSession(session, 0n);
      this.assertStateUsable(state);
      if (!state.pendingActionId || state.pendingActionId !== dto.actionId) {
        throw new ConflictException({ code: 'STALE_ACTION', message: 'That action is no longer pending.' });
      }

      const resolved = resolveBookOfRaGamble(state, dto.choiceId as BookOfRaGambleChoice);
      const next = resolved.state;
      const payout = resolved.outcome.complete ? BigInt(next.pendingWin) : 0n;
      const settled = resolved.outcome.complete;
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
      if (payout > 0n) await this.ledgerCredit(tx, wallet.id, round.id, userId, payout);
      await tx.casinoRound.update({
        where: { id: round.id },
        data: {
          status: settled ? (payout > 0n ? 'WON' : 'LOST') : 'OPEN',
          payout,
          multiplier: payout > 0n && round.stake > 0n
            ? new Prisma.Decimal(payout.toString()).div(round.stake.toString())
            : null,
          publicState: this.publicState(next, next.lastOutcome, payout, settled),
          privateState: this.privateState(next, next.lastOutcome, []),
          settledAt: settled ? new Date() : null,
        },
      });
      await this.writeSession(tx, userId, next);
      const balance = (await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance;
      const response = this.view({
        state: next,
        roundId: round.id,
        wager: 0n,
        payout,
        settled,
        balance,
        idempotent: false,
      });
      await this.rememberRequest(tx, userId, 'action', dto.idempotencyKey, fingerprint, round.id, response);
      await this.audit(tx, userId, round.id, settled ? 'CASINO_ROUND_SETTLED' : 'CASINO_ROUND_STARTED', {
        choiceId: dto.choiceId,
        attempt: resolved.outcome.attempt,
        won: resolved.outcome.won ?? null,
        pendingWin: next.pendingWin,
        payout: payout.toString(),
      });
      return response;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 20_000 });
  }

  // ---------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------

  /**
   * Ensures the player's session row exists and holds its exclusive row lock.
   *
   * The lock is what serialises one player's requests: two concurrent spins or
   * a spin racing a gamble can never both read the same free-spin counters.
   */
  private async lockSession(tx: Prisma.TransactionClient, userId: string): Promise<BookOfRaSession> {
    await tx.$executeRaw`
      INSERT INTO "BookOfRaSession" ("id", "userId", "gameId", "profileId", "profileFingerprint", "phase", "activeLines", "state", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${userId}::uuid, ${BOOK_GAME_ID}, ${BOOK_PROFILE_ID}, ${BOOK_PROFILE_FINGERPRINT}, 'IDLE', ${BOOK_ACTIVE_LINES}, '{}'::jsonb, now())
      ON CONFLICT ("userId") DO NOTHING
    `;
    await tx.$queryRaw`SELECT "id" FROM "BookOfRaSession" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
    return tx.bookOfRaSession.findUniqueOrThrow({ where: { userId } });
  }

  private stateFromSession(session: BookOfRaSession | null, fallbackBetPerLine: bigint): BookOfRaGameState {
    const stored = session
      ? fromFeatureState(session.state as unknown as FeatureState, { profileFingerprint: BOOK_PROFILE_FINGERPRINT })
      : undefined;
    if (stored) return stored;
    const betPerLine = session && session.betPerLine > 0n ? session.betPerLine : fallbackBetPerLine;
    return createBookOfRaState({
      profileId: BOOK_PROFILE_ID,
      profileFingerprint: BOOK_PROFILE_FINGERPRINT,
      betPerLine: (betPerLine > 0n ? betPerLine : 1n).toString(),
      activeLines: BOOK_ACTIVE_LINES,
    });
  }

  /**
   * Refuses to continue a session whose mathematics no longer matches the
   * active profile. A settled round keeps its own recorded fingerprint.
   */
  private assertStateUsable(state: BookOfRaGameState): void {
    if (state.profileFingerprint !== BOOK_PROFILE_FINGERPRINT) {
      throw new ConflictException({
        code: 'PROFILE_CHANGED',
        message: 'This game session was opened under a different mathematics profile.',
      });
    }
    if (state.gameId !== BOOK_ENGINE_GAME_ID) {
      throw new ConflictException({ code: 'INVALID_SESSION', message: 'This session does not belong to Book of the Sands.' });
    }
  }

  private async writeSession(tx: Prisma.TransactionClient, userId: string, state: BookOfRaGameState): Promise<void> {
    const data = {
      profileId: state.profileId,
      profileFingerprint: state.profileFingerprint,
      phase: state.phase,
      activeLines: state.activeLines,
      betPerLine: BigInt(state.betPerLine),
      totalBet: BigInt(state.totalBet),
      specialSymbol: state.specialSymbol ?? null,
      freeSpinsAwarded: state.freeSpinsAwarded,
      freeSpinsRemaining: state.freeSpinsRemaining,
      freeSpinsPlayed: state.freeSpinsPlayed,
      retriggerCount: state.retriggerCount,
      featureWin: BigInt(state.featureWin),
      pendingWin: BigInt(state.pendingWin),
      pendingActionId: state.pendingActionId ?? null,
      pendingRoundId: state.pendingActionId ? state.pendingRoundId ?? null : null,
      state: toFeatureState(state) as unknown as Prisma.InputJsonValue,
    };
    await tx.bookOfRaSession.update({ where: { userId }, data });
  }

  /** Conditional debit: the database refuses to overdraw even under a race. */
  private async debit(tx: Prisma.TransactionClient, walletId: string, amount: bigint): Promise<void> {
    const debited = await tx.wallet.updateMany({
      where: { id: walletId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) {
      throw new ConflictException({
        code: 'INSUFFICIENT_VIRTUAL_BALANCE',
        message: 'Insufficient virtual points.',
      });
    }
  }

  private async ledgerDebit(
    tx: Prisma.TransactionClient,
    walletId: string,
    userId: string,
    roundId: string,
    amount: bigint,
  ): Promise<void> {
    const key = `casino:bet:${roundId}`;
    await tx.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_BET',
        amount: -amount,
        reason: 'Book of the Sands stake',
        actorId: userId,
        relatedCasinoRoundId: roundId,
        idempotencyKey: key,
      },
    });
    await tx.casinoTransaction.create({
      data: { roundId, userId, type: 'BET', amount: -amount, idempotencyKey: key },
    });
  }

  /**
   * Immutable credit. The ledger key is derived from the round, so a retry, a
   * replay and a concurrent resolution all converge on a single win.
   */
  private async ledgerCredit(
    tx: Prisma.TransactionClient,
    walletId: string,
    roundId: string,
    userId: string,
    amount: bigint,
  ): Promise<void> {
    if (amount <= 0n) return;
    const key = `casino:win:${roundId}`;
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (existing) return;
    await tx.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_WIN',
        amount,
        reason: 'Book of the Sands win',
        relatedCasinoRoundId: roundId,
        idempotencyKey: key,
      },
    });
    await tx.casinoTransaction.create({
      data: { roundId, userId, type: 'WIN', amount, idempotencyKey: key },
    });
    await tx.wallet.update({ where: { id: walletId }, data: { balance: { increment: amount } } });
  }

  private roundKey(userId: string, operation: string, requestKey: string): string {
    return `${BOOK_GAME_ID}:${operation}:${userId}:${requestKey}`;
  }

  private fingerprint(operation: string, payload: Record<string, unknown>): string {
    return createHash('sha256').update(canonicalJson({ operation, payload })).digest('hex');
  }

  /**
   * Scoped idempotency.
   *
   * The key is unique per player, game and operation, so one player's key can
   * never resolve another player's request. A key that comes back with a
   * different body is refused rather than answered with the stored response.
   */
  private async replay(
    tx: Prisma.TransactionClient,
    userId: string,
    operation: string,
    requestKey: string,
    fingerprint: string,
  ): Promise<BookOfRaRoundView | null> {
    const existing = await tx.casinoRequestKey.findUnique({
      where: { userId_gameId_operation_requestKey: { userId, gameId: BOOK_GAME_ID, operation, requestKey } },
    });
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'This request identifier was already used with different parameters.',
      });
    }
    return existing.response as unknown as BookOfRaRoundView;
  }

  private async rememberRequest(
    tx: Prisma.TransactionClient,
    userId: string,
    operation: string,
    requestKey: string,
    fingerprint: string,
    roundId: string,
    response: BookOfRaRoundView,
  ): Promise<void> {
    await tx.casinoRequestKey.create({
      data: {
        userId,
        gameId: BOOK_GAME_ID,
        operation,
        requestKey,
        fingerprint,
        roundId,
        response: response as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Runs one request, and answers a racing duplicate with the stored response.
   *
   * The row lock inside the transaction serialises one player's requests, but
   * two requests carrying the same key can still reach the unique index at the
   * same instant. The database then rejects the loser with a uniqueness error;
   * rather than surfacing a 500, the winner's committed response is returned,
   * provided the request body matches. A different body is still refused.
   */
  private async runIdempotent(
    userId: string,
    operation: 'spin' | 'action',
    requestKey: string,
    payload: Record<string, unknown>,
    run: (fingerprint: string) => Promise<BookOfRaRoundView>,
  ): Promise<BookOfRaRoundView> {
    const fingerprint = this.fingerprint(operation, { gameId: BOOK_GAME_ID, ...payload });
    try {
      return await run(fingerprint);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      // The loser of a duplicate-request race must be answered with the
      // winner's stored round.
      const stored = await this.storedResponse(userId, operation, requestKey, fingerprint);
      if (stored) return { ...stored, idempotent: true };
      // Nothing else in this request's own tables can collide, so the remaining
      // uniqueness race is the shared platform-configuration singleton booting
      // for the first time. That transaction rolled back whole, so repeating
      // the request once is safe and cannot settle anything twice.
      try {
        return await run(fingerprint);
      } catch (retryError) {
        const afterRetry = await this.storedResponse(userId, operation, requestKey, fingerprint);
        if (afterRetry) return { ...afterRetry, idempotent: true };
        throw retryError;
      }
    }
  }

  private async storedResponse(
    userId: string,
    operation: string,
    requestKey: string,
    fingerprint: string,
  ): Promise<BookOfRaRoundView | null> {
    const existing = await this.prisma.casinoRequestKey.findUnique({
      where: { userId_gameId_operation_requestKey: { userId, gameId: BOOK_GAME_ID, operation, requestKey } },
    });
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'This request identifier was already used with different parameters.',
      });
    }
    return existing.response as unknown as BookOfRaRoundView;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    userId: string,
    roundId: string,
    action: 'CASINO_ROUND_STARTED' | 'CASINO_ROUND_WON' | 'CASINO_ROUND_LOST' | 'CASINO_ROUND_SETTLED',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: userId,
        targetType: 'CASINO_ROUND',
        targetId: roundId,
        action,
        result: action,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Presentation
  // ---------------------------------------------------------------------

  private winViews(wins: Win[]): WinView[] {
    return wins.map((win) => ({
      evaluator: win.evaluator,
      symbolId: win.symbolId,
      count: win.count,
      ways: win.ways,
      cells: win.cells.map((cell) => ({ reel: cell.reel, row: cell.row })),
      amount: win.payoutUnits,
    }));
  }

  private view(params: {
    state: BookOfRaGameState;
    roundId: string | null;
    wager: bigint;
    payout: bigint;
    settled: boolean;
    balance: bigint | null;
    idempotent: boolean;
  }): BookOfRaRoundView {
    const presentation = bookOfRaPresentation(params.state);
    const last = params.state.lastOutcome;
    return {
      gameId: BOOK_GAME_ID,
      gameType: 'SLOTS',
      profileId: BOOK_PROFILE_ID,
      profileFingerprint: BOOK_PROFILE_FINGERPRINT,
      roundId: params.roundId,
      roundState: presentation.roundState,
      board: presentation.board ?? null,
      wins: last ? this.winViews(last.wins) : [],
      winTotal: last ? last.totalSpinWin : '0',
      expandingReels: presentation.expandingReels ?? [],
      expandingWin: last ? last.expandingWin : '0',
      specialSymbol: presentation.specialSymbol ?? null,
      betPerLine: presentation.betPerLine,
      totalBet: presentation.totalBet,
      activeLines: presentation.activeLines,
      stakeLocked: presentation.freeSpinsRemaining > 0,
      freeSpinsAwarded: params.state.freeSpinsAwarded,
      freeSpinsRemaining: presentation.freeSpinsRemaining,
      freeSpinsPlayed: presentation.freeSpinsPlayed,
      featureWin: presentation.featureWin,
      pendingWin: presentation.pendingWin,
      gambleAttempts: presentation.gambleAttempts,
      gambleMaxAttempts: presentation.gambleMaxAttempts,
      pendingAction: presentation.pendingAction ?? null,
      settlement: {
        wager: params.wager.toString(),
        payout: params.payout.toString(),
        settled: params.settled,
      },
      balance: params.balance === null ? null : params.balance.toString(),
      idempotent: params.idempotent,
    };
  }

  /**
   * Public round state. It carries the board and the payout and is deliberately
   * free of the hidden state (the pre-drawn gamble colours) and of the raw
   * server seed, which the platform only reveals once the round is terminal.
   */
  private publicState(
    state: BookOfRaGameState,
    outcome: BookOfRaGameState['lastOutcome'],
    payout: bigint,
    settled: boolean,
  ): Prisma.InputJsonValue {
    return {
      gameId: BOOK_GAME_ID,
      engineGameId: BOOK_ENGINE_GAME_ID,
      profileId: BOOK_PROFILE_ID,
      profileFingerprint: BOOK_PROFILE_FINGERPRINT,
      outcomeSource: 'node:crypto-csprng',
      roundState: state.phase,
      board: outcome?.finalGrid ?? null,
      revealBoard: outcome?.board ?? null,
      wins: outcome ? this.winViews(outcome.wins) : [],
      expandingReels: outcome?.expandingReels ?? [],
      expandingWin: outcome?.expandingWin ?? '0',
      specialSymbol: state.specialSymbol ?? null,
      betPerLine: state.betPerLine,
      totalBet: state.totalBet,
      activeLines: state.activeLines,
      freeSpinsAwarded: state.freeSpinsAwarded,
      freeSpinsRemaining: state.freeSpinsRemaining,
      freeSpinsPlayed: state.freeSpinsPlayed,
      featureWin: state.featureWin,
      pendingWin: state.pendingWin,
      gambleAttempts: state.gambleAttempts,
      payout: payout.toString(),
      settled,
    } as Prisma.InputJsonValue;
  }

  /**
   * Hidden state: the engine continuation, the pre-drawn gamble ladder, and the
   * RNG draw evidence for the round. None of it is projected while a round is
   * open; it is kept so an unresolved round can be resumed exactly, and so a
   * settled round can be audited against the board it recorded.
   */
  private privateState(
    state: BookOfRaGameState,
    outcome: BookOfRaGameState['lastOutcome'],
    draws: Array<{ value: number; maxExclusive: number; index: number; source: string; reference: string }>,
  ): Prisma.InputJsonValue {
    return {
      engineState: toFeatureState(state),
      pendingActionId: state.pendingActionId ?? null,
      pendingRoundId: state.pendingRoundId ?? null,
      gambleColours: state.gambleColours ?? null,
      gambleHistory: state.gambleHistory ?? [],
      drawCount: draws.length,
      draws: draws.map((draw) => ({
        index: draw.index,
        value: draw.value,
        maxExclusive: draw.maxExclusive,
        source: draw.source,
        reference: draw.reference,
      })),
      board: outcome?.board ?? null,
      finalGrid: outcome?.finalGrid ?? null,
    } as unknown as Prisma.InputJsonValue;
  }

  /** Exposed for the Book-specific verification projection. */
  async roundFor(userId: string, roundId: string): Promise<CasinoRound> {
    const round = await this.prisma.casinoRound.findFirst({ where: { id: roundId, userId } });
    if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    return round;
  }
}
