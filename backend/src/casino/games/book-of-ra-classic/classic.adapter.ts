import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { CasinoGameType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma.service';
import { CasinoConfigService } from '../../casino-config.service';
import {
  GAME_PLATFORM,
  GameActionContext,
  GameAdapter,
  GamePlatform,
  GameRequest,
  ReadClient,
  TransactionClient,
} from '../../platform/game-adapter.types';
import { MathControlService } from '../../platform/math-control/math-control.service';
import { CLASSIC_V1 } from './classic.definition';
import { CLASSIC_PLAY_EVENTS } from './classic.dto';
import {
  CLASSIC_ID,
  ClassicProfile,
  CompleteRound,
  IntRng,
  cryptoRng,
  gamble as drawGamble,
  playRound,
} from './classic.engine';
import { assertClassicArtifact, classicIdentity, defaultClassicProfile } from './classic.math-adapter';
import { projectSpin } from './classic.protocol';
import { nativeLanguage, nativeSettings } from './classic.settings';

export const CLASSIC_OPTIONS = 'CLASSIC_OPTIONS';

/**
 * Classic's own gateway parameters: the scope of a launch capability, how long
 * it and the session live, and the static prefix of the recovered client on the
 * game origin. The controller and the tests read these from here, so the values
 * exist once.
 */
export const CLASSIC_CAPABILITY = {
  scope: `game:${CLASSIC_ID}:play`,
  launchTtlMs: 60_000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
  gamePath: '/games/BookOfRaCL/',
} as const;

/**
 * Test-only seams. The production module supplies the defaults: the OS CSPRNG
 * for every real draw and no failure hooks. Nothing here is reachable from an
 * HTTP request, a header, an environment variable or a fixture file.
 */
export type ClassicOptions = {
  /** Deterministic generator for explicit test construction only. */
  rng?: IntRng;
  /** Fault injection after the prepared outcome is committed, before settlement. */
  afterPrepare?: () => void | Promise<void>;
  /** Fault injection after the wallet write, before the transaction commits. */
  afterDebit?: () => void | Promise<void>;
};

export type ClassicPhase = 'IDLE' | 'FREE_SPINS' | 'PENDING_WIN' | 'GAMBLE';

export type ClassicState = {
  version: number;
  phase: ClassicPhase;
  roundId: string;
  /** Locked per-line stake in whole platform points and the locked line count. */
  bet: number;
  lines: number;
  /**
   * The complete pre-drawn round: the paid spin and every free spin it awards,
   * retriggers included. It is drawn once, before the debit, and then only ever
   * consumed - a free spin, a recovery or a replay never draws again.
   */
  plan: CompleteRound;
  /** Index of the last resolved spin in `plan.spins`. */
  index: number;
  freeTotal: number;
  pendingWin: number;
  /** Points actually credited to the wallet for this round (0 until collect). */
  payout: number;
  /** The wallet balance frozen at the paid spin, shown during the feature. */
  freeBalance: number;
  /** The last spin presentation, kept so a refresh can always redraw the board. */
  result: Record<string, unknown> | null;
  /** The last native gamble presentation, never used to rebuild the board. */
  lastGamble: Record<string, unknown> | null;
  gamble: { attempts: number; cards: string[] };
  /** Pinned maths identity: a round is never re-read under different maths. */
  profileId: string;
  profileHash: string;
  profileVersion: number;
  engineSha256: string;
  maxWin: number;
};

export type GameplayContext = { userId: string; sessionId: string };

const REQUEST_ID = /^[a-zA-Z0-9_-]{8,80}$/;
/** The reference's own gamble text caps the doubling run at five attempts. */
const GAMBLE_MAX_ATTEMPTS = 5;
/** Native dealer-card faces per colour, exactly as the reference server draws them. */
const DEALER_CARDS: Record<'red' | 'black', readonly string[]> = {
  red: ['H', 'D'],
  black: ['S', 'C'],
};
const READ_ONLY_EVENTS = ['getSettings', 'update', 'ack'] as const;

/**
 * Book of Ra Classic - adapter #2 of the reusable game-integration layer.
 *
 * Everything the platform can reuse is gone from this file: the one-time launch
 * capability, the bound game session, the authoritative wallet and ledger,
 * idempotent replay, the presentation receipt gate, prepared-outcome durability
 * and round ownership all come from `casino/platform`.
 *
 * What remains is, deliberately, only what Classic is: its native protocol
 * event names and validation, the canonical semantics of its actions, its nine
 * paylines, its expanding-symbol free games, its red/black gamble, the maths
 * profile its rounds are pinned to, and the exact shape of the recovery payload
 * its recovered client expects.
 */
@Injectable()
export class ClassicAdapter implements GameAdapter {
  readonly gameId = CLASSIC_ID;

  /** Reads, refreshes and presentation receipts: never a money movement. */
  readonly readOnlyEvents = READ_ONLY_EVENTS;

  private readonly options: ClassicOptions;

  constructor(
    private readonly prisma: PrismaService,
    // The shared platform bundle is an interface, so it needs its token: without
    // it Nest has no way to resolve the parameter at runtime.
    @Inject(GAME_PLATFORM) private readonly platform: GamePlatform,
    private readonly configs: CasinoConfigService,
    // Optional so a unit test that builds this adapter directly keeps working.
    @Optional() private readonly mathControl?: MathControlService,
    @Optional() @Inject(CLASSIC_OPTIONS) options: ClassicOptions = {},
  ) {
    this.options = options ?? {};
  }

  private get wallet() {
    return this.platform.wallet;
  }

  private get journal() {
    return this.platform.journal;
  }

  private get rounds() {
    return this.platform.rounds;
  }

  // ---------------------------------------------------------------------------
  // Adapter contract
  // ---------------------------------------------------------------------------

  /** The native event set is the game's own; the platform never enumerates it. */
  validateRequest(body: Record<string, unknown>) {
    const event = typeof body?.slotEvent === 'string' ? body.slotEvent : '';
    if (!(CLASSIC_PLAY_EVENTS as readonly string[]).includes(event)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_EVENT', message: 'Unsupported game event.' });
    }
    return event;
  }

  /**
   * Canonical, order-independent semantics of one validated action.
   *
   * The stake and the line count are validated *here*, before any replay
   * lookup, so a fractional or unsupported value can never be rounded into the
   * semantics of a cached request.
   */
  canonicalizeAction(context: GameActionContext, event: string, body: Record<string, unknown>) {
    const action: Record<string, unknown> = { event, player: context.userId };
    if (event === 'bet' || event === 'freespin') {
      action.stake = this.parseLineStake(body);
      action.lines = this.parseLines(body);
    }
    if (event === 'slotGamble') action.choice = this.parseChoice(body);
    return JSON.stringify(action, Object.keys(action).sort());
  }

  async read(context: GameActionContext, event: string, body: Record<string, unknown>) {
    // Presentation receipts settle nothing, so they never reconcile first.
    if (event === 'ack') return this.acknowledge(context.userId, body);
    await this.reconcilePreparedFor(context.userId);
    if (event === 'getSettings') return this.settings(context.userId);
    if (event === 'update') return this.update(context.userId);
    throw new BadRequestException({ code: 'UNSUPPORTED_EVENT', message: 'Unsupported game event.' });
  }

  async execute(context: GameActionContext, request: GameRequest) {
    const { userId } = context;
    const { event, body, headers, requestId } = request;
    if (!REQUEST_ID.test(requestId)) {
      throw new BadRequestException({ code: 'REQUEST_ID_REQUIRED', message: 'A request identifier is required.' });
    }
    const canonical = this.canonicalizeAction(context, event, body);
    const replay = await this.journal.findReplay(this.gameId, userId, requestId, canonical);
    if (replay) return replay;
    // Reconcile durably prepared outcomes before serving any authoritative
    // state, so a reconnect reports the settled round without a reroll.
    await this.reconcilePreparedFor(userId);
    const settled = await this.journal.findReplay(this.gameId, userId, requestId, canonical);
    if (settled) return settled;

    const scoped: GameplayContext = { userId: context.userId, sessionId: context.sessionId };
    switch (event) {
      case 'bet':
        return this.bet(context, body, headers, requestId, canonical);
      case 'freespin':
        return this.freeSpin(scoped, body, headers, requestId, canonical);
      case 'slotGamble':
        return this.gamble(context, body, headers, requestId, canonical);
      case 'recoveryGamble':
      case 'recoveryCollect':
        return this.recoveryAction(scoped, event, headers, requestId, canonical);
      default:
        throw new BadRequestException({ code: 'UNSUPPORTED_EVENT', message: 'Unsupported game event.' });
    }
  }

  /**
   * Settles anything already durably prepared for this player without drawing.
   * A superseded outcome is dropped so it cannot poison a request identity; a
   * genuine storage failure stays fail-closed and is retried on the next read.
   */
  async reconcilePrepared(context: GameActionContext) {
    await this.reconcilePreparedFor(context.userId);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  private async settings(userId: string) {
    const balance = await this.wallet.balancePoints(this.prisma as unknown as ReadClient, userId);
    return {
      responseEvent: 'getSettings',
      slotLanguage: nativeLanguage(),
      serverResponse: { ...nativeSettings(await this.activeMathReported()), Balance: balance },
      recovery: await this.snapshot(userId),
    };
  }

  private async update(userId: string) {
    const balance = await this.wallet.balancePoints(this.prisma as unknown as ReadClient, userId);
    return {
      responseEvent: 'error',
      responseType: 'update',
      serverResponse: String(balance),
      recovery: await this.snapshot(userId),
    };
  }

  /**
   * Presentation receipt, in the recovered client's own protocol shape. The
   * gate itself is shared: it settles nothing and moves no money.
   */
  private async acknowledge(userId: string, body: Record<string, unknown>) {
    const actionId = typeof body?.actionId === 'string' ? body.actionId : '';
    if (!actionId) return { responseEvent: 'ack', actionId: null, accepted: false, reason: 'missing action id' };
    const result = await this.journal.acknowledge(this.gameId, userId, actionId);
    return { responseEvent: 'ack', ...result };
  }

  // ---------------------------------------------------------------------------
  // Mathematics identity
  // ---------------------------------------------------------------------------

  /**
   * The mathematics a NEW paid round must pin.
   *
   * Read at round start through the control plane and never from a request.
   * When nothing has been activated the game keeps its accepted frozen RTP50
   * artefact, so an untouched deployment behaves exactly as before. A round that
   * has already started keeps the identity recorded in its own state, so
   * activating a different profile cannot change a round in flight, a prepared
   * outcome, a pending feature or a pending gamble.
   */
  private async pinnedMath() {
    if (!this.mathControl) return null;
    const active = await this.mathControl.activeProfile(this.gameId);
    if (!active) return null;
    // Bind the pointer to the mathematics this process actually executes:
    // assertClassicArtifact re-reads the engine and rules identities and refuses
    // a profile generated against a different evaluator or rules table.
    const payload = assertClassicArtifact(active.artifact);
    return {
      payload,
      profileId: active.artifact.profileId,
      profileHash: active.artifact.canonicalHash,
      targetRtpPercent: active.artifact.policy.targetRtpPercent,
      validatedLines: CLASSIC_V1.lines,
      version: active.version,
    };
  }

  private async activeMathReported() {
    const pinned = await this.pinnedMath();
    if (!pinned) return null;
    return {
      profileId: pinned.profileId,
      profileHash: pinned.profileHash,
      targetRtpPercent: pinned.targetRtpPercent,
      validatedLines: pinned.validatedLines,
    };
  }

  // ---------------------------------------------------------------------------
  // Paid round
  // ---------------------------------------------------------------------------

  /**
   * Opens a paid round.
   *
   * The whole round - the paid board *and* every free spin it awards - is drawn
   * before the debit and committed as a prepared outcome, so a crash between the
   * draw and the settlement can only replay the same result. The debit itself
   * happens in the settlement transaction, keyed by the round, so it can be
   * applied exactly once.
   */
  private async bet(
    context: GameActionContext,
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
    requestId: string,
    canonical: string,
  ) {
    const userId = context.userId;
    // Resolved BEFORE the round transaction opens, never inside it: the control
    // plane uses its own pooled connection, and the round transaction holds one
    // for its whole life.
    const pinned = await this.pinnedMath();
    const profile: ClassicProfile = pinned?.payload ?? defaultClassicProfile().payload;
    const bet = this.parseLineStake(body);
    const lines = this.parseLines(body);

    const prepared = await this.journal.serialized(this.gameId, userId, async (tx) => {
      const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
      if (replay) return { response: replay };
      const round = await this.rounds.currentRoundIn(tx, this.gameId, userId);
      this.assertGuard(headers, round);
      await this.journal.assertReceiptIn(tx, this.gameId, userId);
      const key = this.journal.requestKey(userId, requestId);
      await this.journal.assertNoForeignPrepared(tx, this.gameId, userId, key);
      // A concurrent duplicate of this exact request may already be prepared:
      // a row for this key is this request's own in-flight state, so the attempt
      // falls through to settlement instead of inserting a second row (P2002).
      const own = await this.journal.findPreparedIn(tx, key, userId);
      if (own) {
        if (own.kind !== 'bet' || own.canonical !== canonical) this.journal.conflictSemantics();
        return { prepared: true as const };
      }
      const current = round ? this.stateOf(round) : null;
      if (current && current.phase !== 'IDLE') {
        throw this.journal.conflict('ROUND_PENDING', 'Finish the round in progress first.');
      }

      const stake = BigInt(bet * lines);
      // Fail-closed availability and stake gate, read through this transaction
      // so the limits cannot change between the check and the debit.
      const config = await this.configs.assertPlayable(this.gameId, tx);
      if (stake < config.minStake || stake > config.maxStake) {
        throw this.journal.conflict(
          'STAKE_OUTSIDE_LIMITS',
          `A Classic round wagers between ${config.minStake} and ${config.maxStake} points.`,
        );
      }
      if ((await this.wallet.balance(tx, userId)) < stake) {
        throw this.journal.conflict('INSUFFICIENT_VIRTUAL_BALANCE', 'Insufficient virtual points.');
      }

      const plan = playRound(profile, bet, lines, this.options.rng ?? cryptoRng);
      const paid = plan.spins[0];
      const state: ClassicState = {
        version: 1,
        phase: 'IDLE',
        roundId: randomUUID(),
        bet,
        lines,
        plan,
        index: 0,
        freeTotal: paid.awarded,
        pendingWin: paid.evaluation.win,
        payout: 0,
        freeBalance: 0,
        result: null,
        lastGamble: null,
        gamble: { attempts: 0, cards: [] },
        profileId: pinned?.profileId ?? defaultClassicProfile().id,
        profileHash: pinned?.profileHash ?? defaultClassicProfile().hash,
        profileVersion: pinned?.version ?? 1,
        engineSha256: classicIdentity().engineSha256,
        maxWin: profile.maxWinMultiplier,
      };
      await this.journal.prepareOutcome(tx, {
        gameId: this.gameId,
        userId,
        requestKey: key,
        kind: 'bet',
        canonical,
        sessionId: context.sessionId,
        actionId: requestId,
        body,
        payload: state,
        roundId: null,
        originRoundId: round?.id ?? 'none',
        originVersion: current?.version ?? 1,
        originPhase: current?.phase ?? 'IDLE',
      });
      return { prepared: true as const };
    });
    if ('response' in prepared) return prepared.response;

    // The outcome is durable now. A failure here leaves it for the next
    // reconciliation instead of drawing again.
    await this.options.afterPrepare?.();
    return this.settlePreparedOrReject(userId, 'bet', requestId, canonical);
  }

  /**
   * Resolves the next free spin from the stored plan.
   *
   * The sequence was drawn and committed before the debit, so this only consumes
   * the next resolution: no draw, no re-roll and no second debit, ever.
   */
  private async freeSpin(
    context: GameplayContext,
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
    requestId: string,
    canonical: string,
  ) {
    const userId = context.userId;
    const bet = this.parseLineStake(body);
    const lines = this.parseLines(body);
    return this.journal.serialized(this.gameId, userId, async (tx) => {
      const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
      if (replay) return replay;
      const round = await this.rounds.currentRoundIn(tx, this.gameId, userId);
      this.assertGuard(headers, round);
      await this.journal.assertReceiptIn(tx, this.gameId, userId);
      await this.journal.assertNoForeignPrepared(tx, this.gameId, userId, this.journal.requestKey(userId, requestId));
      if (!round) throw this.journal.conflict('NO_ROUND', 'There is no free game to play.');

      const state = this.stateOf(round);
      if (state.phase !== 'FREE_SPINS') throw this.journal.conflict('NO_FREE_SPINS', 'There are no free games pending.');
      // The feature keeps the stake it was triggered with, whatever the player
      // has since selected, and a free spin never debits anything.
      if (bet !== state.bet || lines !== state.lines) {
        throw this.journal.conflict('FREE_SPIN_BET_LOCKED', 'Free games keep the stake they were triggered with.');
      }
      const next = state.plan.spins[state.index + 1];
      if (!next || !next.free) throw this.journal.conflict('FREE_SPINS_EXHAUSTED', 'The free games are complete.');

      const prior = state.pendingWin;
      state.index += 1;
      state.pendingWin = this.exactPoints(state.pendingWin + next.evaluation.win, 'pending win');
      state.freeTotal += next.awarded;
      state.phase = next.remaining > 0 ? 'FREE_SPINS' : (state.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE');
      state.version += 1;
      const balance = await this.wallet.balancePoints(tx, userId);
      const response = this.spinResponse(state, balance, prior);
      state.result = response;
      return this.saveAction(tx, userId, round, state, 'freespin', requestId, canonical, response);
    });
  }

  // ---------------------------------------------------------------------------
  // Native red/black gamble
  // ---------------------------------------------------------------------------

  /**
   * One fair red/black guess, at even odds and capped at five attempts.
   *
   * The draw is committed as a prepared outcome before any state changes, so a
   * lost response can only replay the same card. A win doubles the still-pending
   * win; a loss closes the round with a zero pending win. Neither moves money:
   * the originating stake was already debited once.
   */
  private async gamble(
    context: GameActionContext,
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
    requestId: string,
    canonical: string,
  ) {
    const userId = context.userId;
    const choice = this.parseChoice(body);
    const prepared = await this.journal.serialized(this.gameId, userId, async (tx) => {
      const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
      if (replay) return { response: replay };
      const round = await this.rounds.currentRoundIn(tx, this.gameId, userId);
      this.assertGuard(headers, round);
      await this.journal.assertReceiptIn(tx, this.gameId, userId);
      const key = this.journal.requestKey(userId, requestId);
      await this.journal.assertNoForeignPrepared(tx, this.gameId, userId, key);
      if (!round) throw this.journal.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
      const state = this.stateOf(round);
      if (!['PENDING_WIN', 'GAMBLE'].includes(state.phase) || state.pendingWin <= 0) {
        throw this.journal.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
      }
      if (state.gamble.attempts >= GAMBLE_MAX_ATTEMPTS) {
        throw this.journal.conflict('COLLECT_REQUIRED', `At most ${GAMBLE_MAX_ATTEMPTS} gambles are allowed; collect the win.`);
      }
      const rng = this.options.rng ?? cryptoRng;
      const draw = drawGamble(state.pendingWin, choice, rng);
      // The native dealer card always shows the dealer's own colour: the chosen
      // colour on a win, the opposite colour on a loss.
      const faces = DEALER_CARDS[draw.colour];
      const dealerCard = faces[rng(faces.length)];
      await this.journal.prepareOutcome(tx, {
        gameId: this.gameId,
        userId,
        requestKey: key,
        kind: 'slotGamble',
        canonical,
        sessionId: context.sessionId,
        actionId: requestId,
        body,
        payload: { won: draw.won, dealerCard, payout: draw.payout },
        roundId: round.id,
        originRoundId: round.id,
        originVersion: state.version,
        originPhase: state.phase,
      });
      return { prepared: true as const };
    });
    if ('response' in prepared) return prepared.response;

    await this.options.afterPrepare?.();
    return this.settlePreparedOrReject(userId, 'slotGamble', requestId, canonical);
  }

  /**
   * Settles a durably prepared paid round or gamble, exactly once.
   *
   * A prepared outcome only ever applies to the exact round state it was drawn
   * against; anything else is stale and is refused rather than applied to a
   * newer state.
   */
  private async settlePrepared(
    userId: string,
    kind: 'bet' | 'slotGamble',
    requestId: string,
    canonical: string,
  ) {
    return this.journal.serialized(this.gameId, userId, async (tx) => {
      const key = this.journal.requestKey(userId, requestId);
      const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
      if (replay) {
        await this.journal.deletePrepared(tx, key);
        return replay;
      }
      const prepared = await this.journal.findPreparedIn(tx, key, userId);
      if (!prepared) throw this.journal.conflict('OUTCOME_NOT_PREPARED', 'The prepared outcome is missing.');
      if (prepared.canonical !== canonical) this.journal.conflictSemantics();

      const current = await this.rounds.currentRoundIn(tx, this.gameId, userId);
      const currentState = current ? this.stateOf(current) : null;
      const currentRoundId = current ? current.id : 'none';
      const currentVersion = currentState ? currentState.version : 1;
      const currentPhase = currentState ? currentState.phase : 'IDLE';
      if (
        prepared.originRoundId !== currentRoundId
        || prepared.originVersion !== currentVersion
        || prepared.originPhase !== currentPhase
      ) {
        throw this.journal.conflict('STALE_PREPARED_ACTION', 'A newer round state superseded this action.');
      }

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
      // The originating session and action travel with the prepared outcome, so
      // a settlement reconciled after a reconnect still records who played it.
      const sessionId = prepared.sessionId;
      const actionId = prepared.actionId;

      if (kind === 'bet') {
        const state = prepared.payload as unknown as ClassicState;
        const stake = BigInt(state.bet * state.lines);
        // The round row must exist before any ledger entry can reference it: the
        // append-only ledger never points at a missing round.
        const round = await this.rounds.createRound(tx, {
          id: state.roundId,
          userId,
          gameId: this.gameId,
          gameType: CasinoGameType.SLOTS,
          gameVersion: CLASSIC_V1.version,
          stake,
          publicState: { gameId: this.gameId, phase: state.phase, version: state.version },
          privateState: state,
          clientSeed: `${this.gameId}:${state.roundId}`,
        });
        await this.wallet.debit(tx, {
          walletId: wallet.id,
          userId,
          roundId: round.id,
          amount: stake,
          reason: 'Book of Ra Classic wager',
          key: `casino:${this.gameId}:bet:${round.id}`,
          sessionId,
          actionId,
        });
        // Fault-injection point: the wallet write above is inside this
        // transaction, so a throw here must leave no debit and no orphan row.
        await this.options.afterDebit?.();
        state.freeBalance = await this.wallet.balancePoints(tx, userId);
        state.phase = state.freeTotal > 0
          ? 'FREE_SPINS'
          : (state.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE');
        const response = this.spinResponse(state, state.freeBalance);
        state.result = response;
        await this.persistRoundIn(tx, round, state);
        const stored = await this.journal.bookAction(tx, {
          gameId: this.gameId,
          userId,
          roundId: round.id,
          event: 'bet',
          requestId,
          canonical,
          response: {
            ...response,
            recovery: this.snapshotOf(round.id, state, this.journal.deliveringView(requestId, 'bet'), state.freeBalance),
          },
        });
        await this.journal.deletePrepared(tx, key);
        await tx.auditLog.create({
          data: {
            actorId: userId,
            targetType: 'CASINO_ROUND',
            targetId: round.id,
            action: 'CASINO_ROUND_STARTED',
            result: state.phase,
            metadata: {
              gameId: this.gameId,
              profileHash: state.profileHash,
              stake: stake.toString(),
              pendingWin: state.pendingWin,
            },
          },
        });
        return stored;
      }

      if (!current || !currentState) throw this.journal.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
      if (currentState.gamble.attempts >= GAMBLE_MAX_ATTEMPTS) {
        throw this.journal.conflict('COLLECT_REQUIRED', `At most ${GAMBLE_MAX_ATTEMPTS} gambles are allowed; collect the win.`);
      }
      const draw = prepared.payload as unknown as { won: boolean; dealerCard: string; payout: number };
      const balance = currentState.freeBalance || await this.wallet.balancePoints(tx, userId);
      // The gamble moves nothing between wallet and ledger: it only adjusts the
      // still-pending win, so a loss cannot debit the original stake twice.
      currentState.pendingWin = this.exactPoints(draw.payout, 'pending win');
      currentState.gamble.attempts += 1;
      currentState.gamble.cards.push(draw.dealerCard);
      currentState.version += 1;
      currentState.phase = currentState.pendingWin > 0 ? 'GAMBLE' : 'IDLE';
      const serverResponse = {
        dealerCard: draw.dealerCard,
        gambleState: draw.won ? 'win' : 'lose',
        totalWin: currentState.pendingWin,
        afterBalance: await this.wallet.balancePoints(tx, userId),
        Balance: balance,
      };
      // The board the client must be able to redraw is the last *spin* result;
      // the gamble presentation is kept separately so a refresh after a gamble
      // still restores the exact reels.
      currentState.lastGamble = { responseEvent: 'gambleResult', serverResponse };
      await this.persistRoundIn(tx, current, currentState);
      const stored = await this.journal.bookAction(tx, {
        gameId: this.gameId,
        userId,
        roundId: current.id,
        event: 'slotGamble',
        requestId,
        canonical,
        response: {
          responseEvent: 'gambleResult',
          serverResponse,
          recovery: this.snapshotOf(
            current.id,
            currentState,
            this.journal.deliveringView(requestId, 'slotGamble'),
            serverResponse.afterBalance,
          ),
        },
      });
      await this.journal.deletePrepared(tx, key);
      return stored;
    });
  }

  // ---------------------------------------------------------------------------
  // Recovery actions: enter the gamble screen, or collect the pending win
  // ---------------------------------------------------------------------------

  private async recoveryAction(
    context: GameplayContext,
    event: 'recoveryGamble' | 'recoveryCollect',
    headers: Record<string, string | undefined>,
    requestId: string,
    canonical: string,
  ) {
    const userId = context.userId;
    return this.journal.serialized(this.gameId, userId, async (tx) => {
      const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
      if (replay) return replay;
      const current = await this.rounds.currentRoundIn(tx, this.gameId, userId);
      this.assertGuard(headers, current);
      await this.journal.assertReceiptIn(tx, this.gameId, userId);
      await this.journal.assertNoForeignPrepared(tx, this.gameId, userId, this.journal.requestKey(userId, requestId));
      if (!current) throw this.journal.conflict('NO_ROUND', 'There is no round to recover.');
      const state = this.stateOf(current);
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });

      if (event === 'recoveryGamble') {
        // Entering the gamble screen is a browser-only transition the recovered
        // client cannot persist itself; it records the phase and nothing else.
        if (state.phase !== 'PENDING_WIN' || state.pendingWin <= 0) {
          throw this.journal.conflict('NO_PENDING_GAMBLE', 'There is no pending win to gamble.');
        }
        state.phase = 'GAMBLE';
        state.version += 1;
      } else {
        if (state.phase !== 'PENDING_WIN' && state.phase !== 'GAMBLE') {
          throw this.journal.conflict('NOTHING_TO_COLLECT', 'There is nothing to collect.');
        }
        const pending = state.pendingWin;
        if (pending > 0) {
          // Exactly one credit for the whole round, keyed by round.
          await this.wallet.credit(tx, {
            walletId: wallet.id,
            userId,
            roundId: current.id,
            amount: BigInt(pending),
            reason: 'Book of Ra Classic collect',
            key: `casino:${this.gameId}:win:${current.id}`,
            sessionId: context.sessionId,
            actionId: requestId,
          });
          state.payout = this.exactPoints(state.payout + pending, 'payout');
        }
        state.pendingWin = 0;
        state.phase = 'IDLE';
        state.version += 1;
      }
      await this.persistRoundIn(tx, current, state);
      const balance = await this.wallet.balancePoints(tx, userId);
      return this.journal.bookAction(tx, {
        gameId: this.gameId,
        userId,
        roundId: current.id,
        event,
        requestId,
        canonical,
        response: {
          responseEvent: 'recoveryAck',
          recovery: this.snapshotOf(current.id, state, this.journal.deliveringView(requestId, event), balance),
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Durable prepared-outcome reconciliation
  // ---------------------------------------------------------------------------

  /** Settles stored outcomes without drawing. Called before any state is read. */
  private async reconcilePreparedFor(userId: string) {
    const rows = await this.journal.listPrepared(userId, this.gameId);
    for (const row of rows) {
      const requestId = this.journal.unscopedRequestId(userId, row.requestKey);
      const kind = row.kind === 'slotGamble' ? 'slotGamble' : 'bet';
      try {
        await this.settlePrepared(userId, kind, requestId, await this.canonicalOfPrepared(userId, row.requestKey));
      } catch (error) {
        if (this.isStalePrepared(error)) {
          // A superseded outcome can never be applied. It is dropped in its own
          // transaction so it cannot poison that request identity forever.
          await this.journal.discardPrepared(this.gameId, userId, row.requestKey);
          continue;
        }
        // A genuine storage failure stays fail-closed: the prepared outcome is
        // retained and the same result is settled on the next attempt.
        return;
      }
    }
  }

  private isStalePrepared(error: unknown) {
    if (!(error instanceof ConflictException)) return false;
    const response = error.getResponse();
    return typeof response === 'object' && response !== null
      && (response as { code?: string }).code === 'STALE_PREPARED_ACTION';
  }

  /** Settlement entry point for a caller that owns the request identity. */
  private async settlePreparedOrReject(
    userId: string,
    kind: 'bet' | 'slotGamble',
    requestId: string,
    canonical: string,
  ) {
    try {
      return await this.settlePrepared(userId, kind, requestId, canonical);
    } catch (error) {
      if (this.isStalePrepared(error)) {
        await this.journal.discardPrepared(this.gameId, userId, this.journal.requestKey(userId, requestId));
      }
      throw error;
    }
  }

  private async canonicalOfPrepared(userId: string, requestKey: string) {
    const row = await this.journal.findPrepared(userId, requestKey);
    return row?.canonical ?? '';
  }

  // ---------------------------------------------------------------------------
  // Classic's own rules: denomination, guard, round projection
  // ---------------------------------------------------------------------------

  /**
   * The native ladder is whole platform points: 1/2/5/10/20 per line with 1..9
   * lines selected, so the displayed total stake is exactly the point amount the
   * ledger debits. Nothing here is scaled or rounded.
   */
  private parseLineStake(body: Record<string, unknown>) {
    const value = Number(body.slotBet);
    const units = Math.round(value);
    // Tolerate binary-float noise on a whole number, but reject a genuinely
    // fractional stake instead of rounding it to a nearby native value.
    if (!Number.isFinite(value) || !Number.isSafeInteger(units) || Math.abs(value - units) > 1e-9) {
      throw this.journal.conflict('UNSUPPORTED_STAKE', 'Choose one of the native stake values.');
    }
    if (!(CLASSIC_V1.lineStakes as readonly number[]).includes(units)) {
      throw this.journal.conflict('UNSUPPORTED_STAKE', 'Choose one of the native stake values.');
    }
    return units;
  }

  private parseLines(body: Record<string, unknown>) {
    const lines = Number(body.slotLines);
    if (!Number.isSafeInteger(lines) || !(CLASSIC_V1.lineCounts as readonly number[]).includes(lines)) {
      throw this.journal.conflict('UNSUPPORTED_LINES', 'Classic plays between one and nine lines.');
    }
    return lines;
  }

  private parseChoice(body: Record<string, unknown>): 'red' | 'black' {
    const choice = String(body.gambleChoice ?? '').toLowerCase();
    if (choice !== 'red' && choice !== 'black') {
      throw this.journal.conflict('INVALID_GAMBLE_CHOICE', 'Choose red or black.');
    }
    return choice;
  }

  /** Exact integer point arithmetic; a value the platform cannot hold is refused. */
  private exactPoints(value: number, label: string) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw this.journal.conflict('POINTS_OUT_OF_RANGE', `The ${label} cannot be represented exactly.`);
    }
    return value;
  }

  /**
   * Reads a round's pinned state and refuses to serve it under different maths.
   *
   * The round carries the identity it was opened under, so a later activation is
   * irrelevant here - but the *evaluator* must still be the one that produced the
   * round, and the recorded identity must be well formed.
   */
  private stateOf(round: { privateState: unknown }): ClassicState {
    const state = round.privateState as unknown as ClassicState;
    const { engineSha256 } = classicIdentity();
    const identityWellFormed =
      typeof state?.profileId === 'string' && state.profileId.length > 0 && state.profileId.length <= 120
      && typeof state?.profileHash === 'string' && /^[0-9a-f]{64}$/.test(state.profileHash)
      && Number.isInteger(state?.profileVersion) && state.profileVersion >= 1;
    if (!identityWellFormed || state.engineSha256 !== engineSha256) {
      throw this.journal.conflict('ROUND_MATH_MISMATCH', 'This round was created under different game mathematics.');
    }
    return state;
  }

  /** The client's own round guard: an action must name the state it saw. */
  private assertGuard(
    headers: Record<string, string | undefined>,
    round: { id: string; privateState: unknown } | null,
  ) {
    const expected = round
      ? { version: String(this.stateOf(round).version), round: round.id }
      : { version: '1', round: 'none' };
    const version = headers['x-pilot-version'];
    const roundHeader = headers['x-pilot-round'];
    if (version === undefined || roundHeader === undefined) {
      throw this.journal.conflict('ROUND_GUARD_REQUIRED', 'Round guard headers are required.');
    }
    if (String(version) !== expected.version || String(roundHeader) !== expected.round) {
      throw this.journal.conflict('STALE_ROUND', 'This action refers to a stale round or version.');
    }
  }

  private async persistRoundIn(
    tx: TransactionClient,
    round: { id: string; settledAt: Date | null },
    state: ClassicState,
  ) {
    const terminal = state.phase === 'IDLE';
    await this.rounds.persistRound(tx, round, {
      // A round that actually credited the wallet is CASHED_OUT; a round that
      // closed with nothing credited - including a gambled-away pending win - is
      // LOST with a zero payout, which is what the database's lost-zero check
      // requires.
      status: terminal ? (state.payout > 0 ? 'CASHED_OUT' : 'LOST') : 'OPEN',
      payout: BigInt(state.payout),
      publicState: { gameId: this.gameId, phase: state.phase, version: state.version },
      privateState: state,
      settled: terminal,
    });
  }

  private async saveAction(
    tx: TransactionClient,
    userId: string,
    round: { id: string; settledAt: Date | null },
    state: ClassicState,
    event: string,
    requestId: string,
    canonical: string,
    response: Record<string, unknown>,
  ) {
    await this.persistRoundIn(tx, round, state);
    const balance = await this.wallet.balancePoints(tx, userId);
    return this.journal.bookAction(tx, {
      gameId: this.gameId,
      userId,
      roundId: round.id,
      event,
      requestId,
      canonical,
      response: {
        ...response,
        recovery: this.snapshotOf(round.id, state, this.journal.deliveringView(requestId, event), balance),
      },
    });
  }

  /** The native `spin` envelope for one resolved board. */
  private spinResponse(state: ClassicState, balance: number, prior = 0): Record<string, unknown> {
    return {
      responseEvent: 'spin',
      responseType: state.index > 0 ? 'freespin' : 'bet',
      serverResponse: {
        ...projectSpin(state.plan.spins[state.index], state.lines, prior),
        totalFreeGames: state.freeTotal,
        currentFreeGames: state.index,
        Balance: state.freeBalance,
        afterBalance: balance,
        totalWin: state.pendingWin,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Classic's own recovery payload
  // ---------------------------------------------------------------------------

  private async snapshot(userId: string) {
    const round = await this.rounds.currentRound(this.prisma as unknown as ReadClient, this.gameId, userId);
    return this.snapshotIn(this.prisma as unknown as ReadClient, userId, round);
  }

  private async snapshotIn(db: ReadClient, userId: string, round: { id: string; privateState: unknown } | null) {
    const receipt = await this.journal.receipt(db, this.gameId, userId);
    const balance = await this.wallet.balancePoints(db, userId);
    return this.snapshotOf(round?.id ?? null, round ? this.stateOf(round) : null, receipt, balance);
  }

  private snapshotOf(
    roundId: string | null,
    state: ClassicState | null,
    receipt: { actionId: string | null; event: string | null; delivered: boolean; acked: boolean },
    balance: number,
  ) {
    const frozen = defaultClassicProfile();
    const receiptView = { event: receipt.event, delivered: receipt.delivered, acked: receipt.acked };
    if (!roundId || !state) {
      return {
        version: 1,
        roundId: 'none',
        phase: 'IDLE' as ClassicPhase,
        balance,
        bet: null,
        result: null,
        lastGamble: null,
        pendingWin: 0,
        free: { total: 0, current: 0, remaining: 0, multiplier: 1 },
        gamble: { attempts: 0, cards: [] },
        settlement: { collected: true },
        profile: { id: frozen.id, hash: frozen.hash, version: 1 },
        actionId: receipt.actionId,
        receipt: receiptView,
      };
    }
    return {
      version: state.version,
      roundId,
      phase: state.phase,
      balance,
      // Whole points, exactly as the native stake ladder and the ledger debit.
      bet: { slotBet: state.bet, slotLines: state.lines },
      result: state.result,
      lastGamble: state.lastGamble,
      pendingWin: state.pendingWin,
      free: {
        total: state.freeTotal,
        current: state.index,
        remaining: Math.max(0, state.freeTotal - state.index),
        // Classic's free games carry no per-round stake multiplier; the
        // expanding symbol is carried by the result itself.
        multiplier: 1,
      },
      gamble: state.gamble,
      settlement: { collected: state.phase === 'IDLE' },
      // The round's own pinned identity, never the currently loaded constants.
      profile: { id: state.profileId, hash: state.profileHash, version: state.profileVersion },
      actionId: receipt.actionId,
      receipt: receiptView,
    };
  }
}
