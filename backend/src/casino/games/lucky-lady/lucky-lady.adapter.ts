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
import { CasinoGameRegistry } from '../../casino-game.registry';
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
import { toSafePoints } from '../../platform/game-wallet.service';
import { LUCKY_LADY_V1 } from './lucky-lady.definition';
import { LUCKY_LADY_PLAY_EVENTS } from './lucky-lady.dto';
import {
  LUCKY_LADY_LINES,
  LUCKY_LADY_GAME_ID,
  LUCKY_LADY_PROFILE_VERSION,
  assertLineStake,
  assertSupportedLines,
  createProductionRng,
  drawGamble,
  freeSpinCount,
  freeSpinMultiplier,
  generateCompleteRound,
  loadVerifiedMath,
  nativeLanguage,
  nativeSettings,
  nativeSpin,
  type Board,
  type EngineProfilePayload,
  type FeatureSpin,
  type LineWin,
  type Rng,
} from './lucky-lady.math';
import { resolveMaxWinPin } from './lucky-lady.math-adapter';
import type { MaxWinPin } from '../../platform/math-control/math-control.types';
import {
  buildDistributionSupport,
  selectDistributionOutcome,
  withForcedInitialStops,
  type DistributionIdentity,
} from './lucky-lady.distribution';
import {
  createCryptoMassSelector,
  distributionPolicyHash,
  validateDistributionPolicy,
  type DistributionPolicy,
} from '../../platform/math-control/payout-distribution';

export const LUCKY_LADY_OPTIONS = 'LUCKY_LADY_OPTIONS';

/**
 * Test-only seams. The production module supplies the defaults: the OS CSPRNG
 * for every real draw and no failure hooks. Nothing here is reachable from an
 * HTTP request, a header, an environment variable or a fixture file.
 */
export type LuckyLadyOptions = {
  /** Deterministic generators exist for explicit test construction only. */
  rngFactory?: () => Rng;
  hooks?: {
    beforeSettle?: (info: { requestKey: string; kind: string }) => void | Promise<void>;
    /** Fault injection after the wallet write, before the transaction commits. */
    afterDebit?: (info: { requestKey: string; kind: string }) => void | Promise<void>;
  };
};

export type LuckyLadyPhase = 'IDLE' | 'FREE_SPINS' | 'PENDING_WIN' | 'GAMBLE';

export type LuckyLadyState = {
  version: number;
  phase: LuckyLadyPhase;
  /** Locked per-line stake in whole platform points and the locked line count. */
  bet: number;
  lines: number;
  roundId: string;
  main: { board: Board; lineWins: LineWin[]; scatterCount: number; scatterWin: number; win: number };
  sequence: FeatureSpin[];
  fsIndex: number;
  freeTotal: number;
  freeMultiplier: number;
  bonusWin: number;
  pendingWin: number;
  freeBalance: number;
  gamble: { attempts: number; cards: string[] };
  settlement: { collected: boolean };
  /** Points actually credited to the wallet for this round (0 until collect). */
  payout: number;
  /** The last spin presentation, kept so a refresh can always redraw the board. */
  result: { responseEvent: string; responseType?: string; serverResponse: Record<string, unknown> } | null;
  /** The last native gamble presentation, never used to rebuild the board. */
  lastGamble: { responseEvent: string; serverResponse: Record<string, unknown> } | null;
  /** Pinned maths identity: a round is never re-read under different maths. */
  profileId: string;
  profileHash: string;
  profileVersion: number;
  /** Active-pointer version the round was opened under, when one existed. */
  profilePointerVersion: number | null;
  /**
   * The max-win cap this round was opened under.
   *
   * Captured once, at the new paid round, and then read from this stored state
   * by every later action - free spins, retriggers, gamble, recovery and replay
   * never consult the global active profile. `null` on a legacy round means no
   * cap was pinned, which is exactly what it meant when the round was opened.
   */
  maxWin: MaxWinPin | null;
  /**
   * The opt-in global distribution selection this round was opened under.
   *
   * Written once, at the new paid round, and then read from stored state by
   * free spins, retriggers, gamble, recovery and replay. `null` means the
   * accepted path (or a legacy round) - no policy is re-looked-up.
   */
  distribution: { policyId: string; policyHash: string; selectedClass: string } | null;
  engineSha256: string;
  plannedFeatureSpins: number;
};

export type GameplayContext = { userId: string; sessionId: string };

const LAUNCH_SCOPE = `game:${LUCKY_LADY_GAME_ID}:play`;
const GAME_PATH = '/games/LuckyLadysCharmDX/';
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,80}$/;
/** Bounded reachability enumeration for an opt-in distribution policy. */
const DISTRIBUTION_MAX_BOARDS = 4_096;

/**
 * Lucky Lady's own gateway parameters: the scope of a launch capability, how
 * long it and the session live, and the static prefix of the recovered client
 * on the game origin. The controller and the tests read these from here, so the
 * values exist once.
 */
export const LUCKY_LADY_CAPABILITY = {
  scope: LAUNCH_SCOPE,
  launchTtlMs: 60_000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
  gamePath: GAME_PATH,
} as const;

/**
 * Lucky Lady's Charm Deluxe - adapter #1 of the reusable game-integration
 * layer.
 *
 * Everything the platform can reuse is gone from this file: the one-time
 * launch capability, the bound game session, the authoritative wallet and
 * ledger, idempotent replay, the presentation receipt gate, prepared-outcome
 * durability and round ownership all come from `casino/platform`.
 *
 * What remains is, deliberately, only what is Lucky Lady's own: its native
 * protocol event names and validation, the canonical semantics of its actions,
 * its stake and line rules, its boards, paylines, free games, retrigger and
 * red/black gamble, the maths profile its rounds are pinned to, and the exact
 * shape of the recovery payload its recovered client expects.
 */
@Injectable()
export class LuckyLadyAdapter implements GameAdapter {
  readonly gameId = LUCKY_LADY_GAME_ID;

  /** Reads, refreshes and presentation receipts: never a money movement. */
  readonly readOnlyEvents = ['getSettings', 'update', 'ack'] as const;

  private readonly rngFactory: () => Rng;
  private readonly hooks: LuckyLadyOptions['hooks'];

  constructor(
    private readonly prisma: PrismaService,
    // The shared platform bundle is an interface, so it needs its token: without
    // it Nest has no way to resolve the parameter at runtime.
    @Inject(GAME_PLATFORM) private readonly platform: GamePlatform,
    private readonly configs: CasinoConfigService,
    private readonly registry: CasinoGameRegistry,
    @Optional() @Inject(LUCKY_LADY_OPTIONS) options: LuckyLadyOptions = {},
    @Optional() private readonly mathControl?: MathControlService,
  ) {
    // Production default: OS CSPRNG, one generator per draw. A deterministic
    // factory can only be supplied by a test that builds this adapter itself.
    this.rngFactory = options.rngFactory ?? createProductionRng;
    this.hooks = options.hooks ?? {};
  }

  private get capabilities() {
    return this.platform.capabilities;
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
    if (!(LUCKY_LADY_PLAY_EVENTS as readonly string[]).includes(event)) {
      throw new BadRequestException({ code: 'UNSUPPORTED_EVENT', message: 'Unsupported game event.' });
    }
    return event;
  }

  /**
   * Canonical, order-independent semantics of one validated action.
   *
   * The stake and line count are validated *here*, before any replay lookup, so
   * a fractional or unsupported value can never be rounded into the semantics
   * of a cached request.
   */
  canonicalizeAction(context: GameActionContext, event: string, body: Record<string, unknown>) {
    const action: Record<string, unknown> = { event, player: context.userId };
    if (event === 'bet' || event === 'freespin') {
      action.stakeUnits = this.parseLineStake(body);
      action.lines = this.parseLines(body);
    }
    if (event === 'slotGamble') action.choice = String(body.gambleChoice ?? '').toLowerCase();
    return JSON.stringify(action, Object.keys(action).sort());
  }

  async read(context: GameActionContext, event: string, body: Record<string, unknown>) {
    // Presentation receipts settle nothing, so they never reconcile first.
    if (event === 'ack') return this.acknowledge(context.userId, body);
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
        return this.bet(scoped, body, headers, requestId, canonical);
      case 'freespin':
        return this.freeSpin(scoped, body, headers, requestId, canonical);
      case 'slotGamble':
        return this.gamble(scoped, body, headers, requestId, canonical);
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
    await this.reconcilePreparedFor(userId);
    const balance = await this.wallet.balancePoints(this.prisma as unknown as ReadClient, userId);
    return {
      responseEvent: 'getSettings',
      slotLanguage: nativeLanguage(),
      serverResponse: { ...nativeSettings(await this.activeMathReported()), Balance: balance },
      recovery: await this.snapshot(userId),
    };
  }

  /**
   * The mathematics a NEW paid round must pin.
   *
   * Read at round start through the control plane, never from a request. When
   * nothing has been activated the game keeps its accepted frozen RTP50
   * artefact, so an untouched deployment behaves exactly as before. A round
   * that has already started keeps the identity recorded in its own state, so
   * activating a different profile cannot change a round in flight, a prepared
   * outcome, a pending feature or a pending gamble.
   */
  private async pinnedMath() {
    if (!this.mathControl) return null;
    const active = await this.mathControl.activeProfile(this.gameId);
    if (!active) return null;
    // Bind the pointer to the mathematics this process actually executes: a
    // profile generated against a different evaluator or rules table must never
    // be run under this one.
    const verified = loadVerifiedMath();
    if (
      active.artifact.engineSha256 !== verified.hashes.engineSha256 ||
      active.artifact.rulesSha256 !== verified.hashes.rulesSha256
    ) {
      throw new Error(
        `MATH_ENGINE_MISMATCH: active profile ${active.artifact.profileId} was generated against ` +
        `engine ${active.artifact.engineSha256}/${active.artifact.rulesSha256}, this process runs ` +
        `${verified.hashes.engineSha256}/${verified.hashes.rulesSha256}`,
      );
    }
    const policy = active.artifact.policy;
    return {
      payload: active.artifact.payload as unknown as EngineProfilePayload,
      profileId: active.artifact.profileId,
      profileHash: active.artifact.canonicalHash,
      targetRtpPercent: policy.targetRtpPercent,
      validatedLines: LUCKY_LADY_LINES,
      version: active.version,
      validationId: active.validationId,
      // The cap metadata travels with the profile identity of the new round.
      maxWinPin: resolveMaxWinPin(policy, active.artifact.profileId, active.artifact.canonicalHash),
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

  private async update(userId: string) {
    await this.reconcilePreparedFor(userId);
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
  // Paid round
  // ---------------------------------------------------------------------------

  private async bet(
    context: GameplayContext,
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
    requestId: string,
    canonical: string,
  ) {
    const userId = context.userId;
    const prepared = await this.journal.serialized<{ replay?: unknown; conflict?: unknown; row?: { requestKey: string } }>(
      this.gameId,
      userId,
      async (tx) => {
        const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
        if (replay) return { replay };
        const current = await this.rounds.currentRoundIn(tx, this.gameId, userId);
        this.assertGuard(headers, current);
        await this.journal.assertReceiptIn(tx, this.gameId, userId);
        await this.journal.assertNoForeignPrepared(
          tx,
          this.gameId,
          userId,
          this.journal.requestKey(userId, requestId),
        );
        const state = current ? this.stateOf(current) : null;
        if (state && state.phase !== 'IDLE') {
          return {
            conflict: {
              responseEvent: 'recoveryConflict',
              reason: 'complete the current feature first',
              recovery: await this.snapshotIn(tx as unknown as ReadClient, userId, current),
            },
          };
        }
        const units = this.parseLineStake(body);
        const lines = this.parseLines(body);
        this.registry.assertEnabled(this.gameId);
        const effective = await this.configs.assertPlayable(this.gameId);
        const wager = BigInt(units * lines);
        // The operator's configured limits are enforced, not ignored. This game
        // publishes a fixed native ladder, so its spec refuses any candidate
        // that would move those limits away from it.
        if (wager < effective.minStake) {
          throw this.journal.conflict('STAKE_BELOW_MINIMUM', `Minimum stake is ${effective.minStake} points.`);
        }
        if (wager > effective.maxStake) {
          throw this.journal.conflict('STAKE_ABOVE_MAXIMUM', `Maximum stake is ${effective.maxStake} points.`);
        }
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
        // Sufficient balance is checked before any draw: no RNG on a round that
        // cannot be paid for.
        if (wallet.balance < wager) {
          throw new ConflictException({ code: 'INSUFFICIENT_VIRTUAL_BALANCE', message: 'Insufficient virtual points.' });
        }
        const key = this.journal.requestKey(userId, requestId);
        const existing = await this.journal.findPreparedIn(tx, key, userId);
        if (existing) {
          if (existing.canonical !== canonical) this.journal.conflictSemantics();
          return { row: { requestKey: key } };
        }
        // Pin the mathematics before the draw: the round records the exact
        // profile identity it was produced under.
        const pinned = await this.pinnedMath();
        // Opt-in global distribution: selected once, here, from the
        // pre-validated reachable support of the pinned profile, then persisted
        // on the round. Absence keeps the accepted path byte-equivalent.
        let distributionPin: LuckyLadyState['distribution'] = null;
        let rng = this.rngFactory();
        const envelope = this.distributionEnvelope((effective as { gameSpecific?: unknown }).gameSpecific);
        if (envelope) {
          if (!pinned) {
            throw this.journal.conflict(
              'DISTRIBUTION_REQUIRES_PINNED_MATH',
              'A distribution policy needs an activated RESOLVED_SPIN mathematics profile.',
            );
          }
          const policyHash = distributionPolicyHash(envelope.policy);
          if (envelope.declaredHash && envelope.declaredHash !== policyHash) {
            throw this.journal.conflict(
              'DISTRIBUTION_POLICY_HASH_MISMATCH',
              'The declared distribution policy hash does not match the policy content.',
            );
          }
          if (
            envelope.policy.gameId !== this.gameId ||
            envelope.policy.mathProfileId !== pinned.profileId ||
            envelope.policy.mathProfileHash !== pinned.profileHash ||
            envelope.policy.maxWinScope !== pinned.maxWinPin.maxWinScope ||
            envelope.policy.maxWinMultiplier !== pinned.maxWinPin.maxWinMultiplier
          ) {
            throw this.journal.conflict(
              'DISTRIBUTION_MATH_MISMATCH',
              'The distribution policy is not bound to the pinned mathematics and its RESOLVED_SPIN cap.',
            );
          }
          const identity: DistributionIdentity = {
            profileId: pinned.profileId,
            profileHash: pinned.profileHash,
            payload: pinned.payload,
          };
          const built = buildDistributionSupport(identity, envelope.policy, { maxBoards: DISTRIBUTION_MAX_BOARDS });
          if (!built.ok) {
            throw this.journal.conflict(
              'DISTRIBUTION_SUPPORT_UNPROVABLE',
              built.reasons.map((entry) => entry.constraint).join(', '),
            );
          }
          const choice = selectDistributionOutcome(built.support, createCryptoMassSelector());
          rng = withForcedInitialStops(rng, identity.payload, choice.stops);
          distributionPin = {
            policyId: envelope.policy.policyId,
            policyHash,
            selectedClass: choice.class,
          };
        }
        const { round } = generateCompleteRound({
          rng,
          bet: units,
          lines,
          weighting: pinned?.payload,
        });
        const stateOut: LuckyLadyState = {
          version: 1,
          phase: 'IDLE',
          bet: units,
          lines,
          roundId: randomUUID(),
          main: {
            board: round.board,
            lineWins: round.mainEval.lineWins,
            scatterCount: round.mainEval.scatterCount,
            scatterWin: round.mainEval.scatterWin,
            win: round.mainEval.totalWin,
          },
          sequence: round.feature.sequence ?? [],
          fsIndex: 0,
          freeTotal: round.feature.spins > 0 ? freeSpinCount() : 0,
          freeMultiplier: freeSpinMultiplier(),
          bonusWin: round.mainEval.totalWin,
          pendingWin: round.mainEval.totalWin,
          freeBalance: 0,
          gamble: { attempts: 0, cards: [] },
          settlement: { collected: round.mainEval.totalWin === 0 && round.feature.spins === 0 },
          payout: 0,
          result: null,
          lastGamble: null,
          profileId: pinned?.profileId ?? loadVerifiedMath().profile.id,
          profileHash: pinned?.profileHash ?? loadVerifiedMath().hashes.profileCanonicalHash,
          profileVersion: LUCKY_LADY_PROFILE_VERSION,
          profilePointerVersion: pinned?.version ?? null,
          // Pinned once, here, for the life of the round.
          maxWin: pinned?.maxWinPin ?? null,
          distribution: distributionPin,
          engineSha256: loadVerifiedMath().hashes.engineSha256,
          plannedFeatureSpins: round.feature.spins,
        };
        await this.journal.prepareOutcome(tx, {
          gameId: this.gameId,
          userId,
          requestKey: key,
          kind: 'bet',
          canonical,
          // The originating session travels with the outcome, so a reconciled
          // settlement keeps the session that actually played the round.
          sessionId: context.sessionId,
          actionId: requestId,
          originRoundId: current ? current.id : 'none',
          originVersion: state ? state.version : 1,
          originPhase: state ? state.phase : 'IDLE',
          body,
          payload: stateOut,
        });
        return { row: { requestKey: key } };
      },
    );
    if (prepared.replay) return prepared.replay;
    if (prepared.conflict) return prepared.conflict;
    return this.settlePreparedOrReject(userId, 'bet', requestId, canonical);
  }

  // ---------------------------------------------------------------------------
  // Free spins (no draw, no wager)
  // ---------------------------------------------------------------------------

  private async freeSpin(
    context: GameplayContext,
    body: Record<string, unknown>,
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
      await this.journal.assertNoForeignPrepared(
        tx,
        this.gameId,
        userId,
        this.journal.requestKey(userId, requestId),
      );
      if (!current) throw this.journal.conflict('NO_ACTIVE_FREE_SPIN', 'There is no active free spin.');
      const state = this.stateOf(current);
      if (state.phase !== 'FREE_SPINS') {
        throw this.journal.conflict('NO_ACTIVE_FREE_SPIN', 'There is no active free spin.');
      }
      const units = this.parseLineStake(body);
      const lines = this.parseLines(body);
      if (units !== state.bet || lines !== state.lines) {
        throw this.journal.conflict('FREE_SPIN_BET_LOCKED', 'The free-spin stake is locked to the triggering spin.');
      }
      const next = state.sequence[state.fsIndex];
      if (!next) throw this.journal.conflict('FREE_SPINS_EXHAUSTED', 'The free-spin sequence is exhausted.');

      const native = nativeSpin(next.board, next, { isFree: true, priorPoints: state.bonusWin });
      state.version += 1;
      state.fsIndex += 1;
      if (next.retriggered) state.freeTotal += freeSpinCount();
      state.bonusWin += next.spinWin;
      state.pendingWin = state.bonusWin;
      const finished = state.fsIndex >= state.freeTotal;
      state.phase = finished ? (state.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE') : 'FREE_SPINS';
      if (state.phase === 'IDLE') state.settlement = { collected: true };

      const balance = await this.wallet.balancePoints(tx, userId);
      const serverResponse = {
        totalFreeGames: state.freeTotal,
        currentFreeGames: state.fsIndex,
        Balance: state.freeBalance,
        afterBalance: balance,
        totalWin: state.bonusWin,
        winLines: native.winLines,
        bonusInfo: native.bonusInfo,
        Jackpots: {},
        reelsSymbols: native.reelsSymbols,
      };
      state.result = { responseEvent: 'spin', responseType: 'freespin', serverResponse };
      await this.persistRoundIn(tx, current, state);
      const response = { responseEvent: 'spin', responseType: 'freespin', serverResponse };
      const full = {
        ...response,
        recovery: this.snapshotOf(current.id, state, this.journal.deliveringView(requestId, 'freespin'), balance),
      };
      return this.journal.bookAction(tx, {
        gameId: this.gameId,
        userId,
        roundId: current.id,
        event: 'freespin',
        requestId,
        canonical,
        response: full,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Gamble (durable prepared card, then settlement)
  // ---------------------------------------------------------------------------

  private async gamble(
    context: GameplayContext,
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
    requestId: string,
    canonical: string,
  ) {
    const userId = context.userId;
    const prepared = await this.journal.serialized<{ replay?: unknown; row?: { requestKey: string } }>(
      this.gameId,
      userId,
      async (tx) => {
        const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
        if (replay) return { replay };
        const current = await this.rounds.currentRoundIn(tx, this.gameId, userId);
        this.assertGuard(headers, current);
        await this.journal.assertReceiptIn(tx, this.gameId, userId);
        // A prepared outcome for another request blocks this one: two distinct
        // gambles may not both draw against the same round version.
        await this.journal.assertNoForeignPrepared(
          tx,
          this.gameId,
          userId,
          this.journal.requestKey(userId, requestId),
        );
        if (!current) throw this.journal.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
        const state = this.stateOf(current);
        if (state.phase !== 'PENDING_WIN' && state.phase !== 'GAMBLE') {
          throw this.journal.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
        }
        const choice = String(body.gambleChoice ?? '').toLowerCase();
        if (choice !== 'red' && choice !== 'black') {
          throw this.journal.conflict('INVALID_GAMBLE_CHOICE', 'Choose red or black.');
        }
        const key = this.journal.requestKey(userId, requestId);
        const existing = await this.journal.findPreparedIn(tx, key, userId);
        if (existing) {
          if (existing.canonical !== canonical) this.journal.conflictSemantics();
          return { row: { requestKey: key } };
        }
        const draw = drawGamble({ rng: this.rngFactory(), choice });
        await this.journal.prepareOutcome(tx, {
          gameId: this.gameId,
          userId,
          requestKey: key,
          kind: 'gamble',
          canonical,
          sessionId: context.sessionId,
          actionId: requestId,
          // The round version and phase this draw was made against; settlement
          // refuses to apply it to any other state.
          roundId: current.id,
          originRoundId: current.id,
          originVersion: state.version,
          originPhase: state.phase,
          body,
          payload: draw,
        });
        return { row: { requestKey: key } };
      },
    );
    if (prepared.replay) return prepared.replay;
    return this.settlePreparedOrReject(userId, 'gamble', requestId, canonical);
  }

  /**
   * Settles the durably stored outcome exactly once.
   *
   * This is the only place a prepared row becomes money: the stored result is
   * consumed, never redrawn, and the wager is debited with the same transaction
   * that records the round, the ledger entries and the cached response.
   */
  private async settlePrepared(userId: string, kind: 'bet' | 'gamble', requestId: string, canonical: string) {
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

      // A prepared action is only ever applied to the exact round state it was
      // drawn against. Anything else means a newer authoritative state exists
      // and this stored outcome is stale.
      const current = await this.rounds.currentRoundIn(tx, this.gameId, userId);
      const currentId = current ? current.id : 'none';
      const currentState = current ? this.stateOf(current) : null;
      const currentVersion = currentState ? currentState.version : 1;
      if (prepared.originRoundId !== currentId || prepared.originVersion !== currentVersion) {
        throw this.journal.conflict('STALE_PREPARED_ACTION', 'A newer round state superseded this action.');
      }
      await this.hooks?.beforeSettle?.({ requestKey: key, kind });

      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
      // The originating session and action travel with the prepared outcome, so
      // a settlement reconciled after a reconnect still records who played it.
      const sessionId = prepared.sessionId;
      const actionId = prepared.actionId;

      if (kind === 'bet') {
        const state = prepared.payload as unknown as LuckyLadyState;
        const wager = BigInt(state.bet * state.lines);
        // The round row must exist before any ledger entry can reference it:
        // the append-only ledger never points at a missing round.
        const round = await this.createRoundIn(tx, userId, state);
        await this.wallet.debit(tx, {
          walletId: wallet.id,
          userId,
          roundId: round.id,
          amount: wager,
          reason: 'Lucky Lady wager',
          key: `casino:lucky-lady:bet:${round.id}`,
          sessionId,
          actionId,
        });
        // Fault-injection point: the wallet write above is inside this
        // transaction, so a throw here must leave no debit and no orphan row.
        await this.hooks?.afterDebit?.({ requestKey: key, kind });
        state.freeBalance = await this.wallet.balancePoints(tx, userId);
        const phase: LuckyLadyPhase = state.freeTotal > 0
          ? 'FREE_SPINS'
          : (state.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE');
        state.phase = phase;
        if (phase === 'IDLE') state.settlement = { collected: true };
        const spin = nativeSpin(state.main.board, state.main, { isFree: false });
        const balance = await this.wallet.balancePoints(tx, userId);
        const serverResponse = {
          totalFreeGames: state.freeTotal,
          currentFreeGames: 0,
          Balance: state.freeBalance,
          afterBalance: balance,
          totalWin: state.main.win,
          winLines: spin.winLines,
          bonusInfo: spin.bonusInfo,
          Jackpots: {},
          reelsSymbols: spin.reelsSymbols,
        };
        state.result = { responseEvent: 'spin', responseType: 'bet', serverResponse };
        await this.persistRoundIn(tx, round, state);
        const response = { responseEvent: 'spin', responseType: 'bet', serverResponse };
        const full = {
          ...response,
          recovery: this.snapshotOf(round.id, state, this.journal.deliveringView(requestId, 'bet'), balance),
        };
        const stored = await this.journal.bookAction(tx, {
          gameId: this.gameId,
          userId,
          roundId: round.id,
          event: 'bet',
          requestId,
          canonical,
          response: full,
        });
        await this.journal.deletePrepared(tx, key);
        await tx.auditLog.create({
          data: {
            actorId: userId,
            targetType: 'CASINO_ROUND',
            targetId: round.id,
            action: 'CASINO_ROUND_STARTED',
            result: phase,
            metadata: {
              gameId: this.gameId,
              profileHash: state.profileHash,
              stake: wager.toString(),
              pendingWin: state.pendingWin,
            },
          },
        });
        return stored;
      }

      if (!current) throw this.journal.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
      if (prepared.originPhase !== currentState?.phase) {
        throw this.journal.conflict('STALE_PREPARED_ACTION', 'A newer round state superseded this action.');
      }
      const state = currentState as LuckyLadyState;
      const draw = prepared.payload as unknown as { win: boolean; dealerCard: string };
      const stake = state.pendingWin;
      const balanceBefore = this.toSafePoints(wallet.balance, 'wallet balance');
      // Gamble moves nothing between wallet and ledger: it only adjusts the
      // still-pending win. A loss cannot debit the original stake a second time.
      if (draw.win) state.pendingWin = stake * 2;
      else state.pendingWin = 0;
      state.gamble.attempts += 1;
      state.gamble.cards.push(draw.dealerCard);
      state.version += 1;
      state.phase = state.pendingWin > 0 ? 'GAMBLE' : 'IDLE';
      if (state.phase === 'IDLE') state.settlement = { collected: true };
      const serverResponse = {
        dealerCard: draw.dealerCard,
        gambleState: draw.win ? 'win' : 'lose',
        totalWin: state.pendingWin,
        afterBalance: await this.wallet.balancePoints(tx, userId),
        Balance: balanceBefore,
      };
      // The board the client must be able to redraw is the last *spin* result;
      // the gamble presentation is kept separately so a refresh after a gamble
      // still restores the exact reels.
      state.lastGamble = { responseEvent: 'gambleResult', serverResponse };
      await this.persistRoundIn(tx, current, state);
      const response = { responseEvent: 'gambleResult', serverResponse };
      const full = {
        ...response,
        recovery: this.snapshotOf(
          current.id,
          state,
          this.journal.deliveringView(requestId, 'slotGamble'),
          serverResponse.afterBalance,
        ),
      };
      const stored = await this.journal.bookAction(tx, {
        gameId: this.gameId,
        userId,
        roundId: current.id,
        event: 'slotGamble',
        requestId,
        canonical,
        response: full,
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
      await this.journal.assertNoForeignPrepared(
        tx,
        this.gameId,
        userId,
        this.journal.requestKey(userId, requestId),
      );
      if (!current) throw this.journal.conflict('NO_ROUND', 'There is no round to recover.');
      const state = this.stateOf(current);
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });

      if (event === 'recoveryGamble') {
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
          // Exactly one credit for the whole feature, keyed by round.
          await this.wallet.credit(tx, {
            walletId: wallet.id,
            userId,
            roundId: current.id,
            amount: BigInt(pending),
            reason: 'Lucky Lady collect',
            key: `casino:lucky-lady:win:${current.id}`,
            sessionId: context.sessionId,
            actionId: requestId,
          });
          state.payout += pending;
        }
        state.pendingWin = 0;
        state.phase = 'IDLE';
        state.settlement = { collected: true };
        state.version += 1;
      }
      await this.persistRoundIn(tx, current, state);
      const full = {
        responseEvent: 'recoveryAck',
        recovery: this.snapshotOf(
          current.id,
          state,
          this.journal.deliveringView(requestId, event),
          await this.wallet.balancePoints(tx, userId),
        ),
      };
      return this.journal.bookAction(tx, {
        gameId: this.gameId,
        userId,
        roundId: current.id,
        event,
        requestId,
        canonical,
        response: full,
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
      try {
        await this.settlePrepared(
          userId,
          row.kind === 'gamble' ? 'gamble' : 'bet',
          requestId,
          await this.canonicalOfPrepared(userId, row.requestKey),
        );
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
  private async settlePreparedOrReject(userId: string, kind: 'bet' | 'gamble', requestId: string, canonical: string) {
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
  // Lucky Lady's own rules: denomination, guard, round projection
  // ---------------------------------------------------------------------------

  /**
   * The native ladder is whole platform points: 1/2/5/10/20 per line, so the
   * displayed total stake (per line x ten lines) is exactly the point amount
   * the ledger debits. Nothing here is scaled or rounded.
   */
  private parseLineStake(body: Record<string, unknown>) {
    const value = Number(body.slotBet);
    if (!Number.isFinite(value)) {
      throw this.journal.conflict('UNSUPPORTED_STAKE', 'Choose one of the native stake values.');
    }
    const units = Math.round(value);
    // Tolerate binary-float noise on a whole number, but reject a genuinely
    // fractional stake instead of rounding it to a nearby native value.
    if (!Number.isSafeInteger(units) || Math.abs(value - units) > 1e-9) {
      throw this.journal.conflict('UNSUPPORTED_STAKE_PRECISION', 'Use a native stake value.');
    }
    if (units <= 0) {
      throw this.journal.conflict('UNSUPPORTED_STAKE', 'Choose one of the native stake values.');
    }
    try {
      assertLineStake(units);
    } catch (error) {
      throw this.journal.conflict((error as { code?: string }).code ?? 'UNSUPPORTED_STAKE', (error as Error).message);
    }
    return units;
  }

  private parseLines(body: Record<string, unknown>) {
    const lines = Number(body.slotLines);
    try {
      assertSupportedLines(lines);
    } catch (error) {
      throw this.journal.conflict((error as { code?: string }).code ?? 'UNSUPPORTED_LINES', (error as Error).message);
    }
    return lines;
  }

  private toSafePoints(value: bigint, label: string) {
    return toSafePoints(value, label);
  }

  /**
   * Reads a round's pinned state and refuses to serve it under different maths.
   *
   * The round carries the identity it was opened under, so a later activation
   * is irrelevant here - but the *evaluator* must still be the one that
   * produced the round, and the recorded identity must be well formed. A
   * tampered private state or a swapped engine fails closed rather than quietly
   * re-pricing a round that was already played.
   */
  private stateOf(round: { privateState: unknown }) {
    const state = round.privateState as unknown as LuckyLadyState;
    const { hashes } = loadVerifiedMath();
    const identityWellFormed =
      typeof state?.profileId === 'string' && state.profileId.length > 0 && state.profileId.length <= 120 &&
      typeof state?.profileHash === 'string' && /^[0-9a-f]{64}$/.test(state.profileHash) &&
      Number.isInteger(state?.profileVersion) && state.profileVersion >= 1;
    if (!identityWellFormed || state.engineSha256 !== hashes.engineSha256) {
      throw this.journal.conflict('ROUND_MATH_MISMATCH', 'This round was created under different game mathematics.');
    }
    // A round opened before the pin existed has no cap metadata; it keeps that
    // meaning (`null`) and is never back-filled from the current active profile.
    if (state.maxWin === undefined || state.distribution === undefined) {
      return { ...state, maxWin: state.maxWin ?? null, distribution: state.distribution ?? null };
    }
    return state;
  }

  /**
   * The optional, server-only distribution envelope carried by the immutable
   * game configuration (`gameSpecific.distributionPolicy`).
   *
   * Absence leaves the accepted path exactly as it was. A present envelope is
   * validated, must declare the same hash it hashes to, and is later bound to
   * the pinned active math artifact; anything else fails closed.
   */
  private distributionEnvelope(gameSpecific: unknown): { policy: DistributionPolicy; declaredHash: string | null } | null {
    if (!gameSpecific || typeof gameSpecific !== 'object') return null;
    const envelope = (gameSpecific as Record<string, unknown>).distributionPolicy;
    if (envelope === undefined || envelope === null) return null;
    const validated = validateDistributionPolicy(envelope);
    if (!validated.ok) {
      throw this.journal.conflict(
        'DISTRIBUTION_POLICY_INVALID',
        validated.reasons.map((entry) => entry.constraint).join(', '),
      );
    }
    const declared = (gameSpecific as Record<string, unknown>).distributionPolicyHash;
    if (declared !== undefined && (typeof declared !== 'string' || !/^[0-9a-f]{64}$/.test(declared))) {
      throw this.journal.conflict('DISTRIBUTION_POLICY_HASH_INVALID', 'The declared policy hash is not a SHA-256 hex value.');
    }
    return { policy: validated.policy, declaredHash: typeof declared === 'string' ? declared : null };
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

  private async createRoundIn(tx: TransactionClient, userId: string, state: LuckyLadyState) {
    return this.rounds.createRound(tx, {
      id: state.roundId,
      userId,
      gameId: this.gameId,
      gameType: CasinoGameType.SLOTS,
      gameVersion: LUCKY_LADY_V1.version,
      stake: BigInt(state.bet * state.lines),
      publicState: this.roundProjection(state, false).publicState,
      privateState: state,
      clientSeed: `${this.gameId}:${state.roundId}`,
    });
  }

  private async persistRoundIn(
    tx: TransactionClient,
    round: { id: string; settledAt: Date | null },
    state: LuckyLadyState,
  ) {
    const terminal = state.phase === 'IDLE';
    const columns = this.roundProjection(state, terminal);
    await this.rounds.persistRound(tx, round, {
      status: columns.status,
      payout: BigInt(state.payout),
      publicState: columns.publicState,
      privateState: state,
      settled: terminal,
    });
  }

  /**
   * Round status columns. A round that actually credited the wallet is
   * CASHED_OUT; a round that closed with nothing credited - including a
   * gambled-away pending win - is LOST with a zero payout, which is exactly
   * what the database's `CasinoRound_lost_zero_payout_check` requires.
   */
  private roundProjection(state: LuckyLadyState, terminal: boolean) {
    const publicState = { gameId: this.gameId, phase: state.phase, version: state.version };
    if (!terminal) return { status: 'OPEN' as const, publicState };
    return {
      status: (state.payout > 0 ? 'CASHED_OUT' : 'LOST') as 'CASHED_OUT' | 'LOST',
      publicState,
    };
  }

  // ---------------------------------------------------------------------------
  // Lucky Lady's own recovery payload
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
    state: LuckyLadyState | null,
    receipt: { actionId: string | null; event: string | null; delivered: boolean; acked: boolean },
    balance: number,
  ) {
    const { profile } = loadVerifiedMath();
    const receiptView = { event: receipt.event, delivered: receipt.delivered, acked: receipt.acked };
    if (!roundId || !state) {
      return {
        version: 1,
        roundId: 'none',
        phase: 'IDLE',
        balance,
        bet: null,
        result: null,
        pendingWin: 0,
        lastGamble: null,
        free: { total: 0, current: 0, remaining: 0, multiplier: 1 },
        gamble: { attempts: 0, cards: [] },
        settlement: { collected: true },
        profile: { id: profile.id, hash: profile.canonicalHash, version: LUCKY_LADY_PROFILE_VERSION },
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
        current: state.fsIndex,
        remaining: Math.max(0, state.freeTotal - state.fsIndex),
        multiplier: state.freeMultiplier,
      },
      gamble: state.gamble,
      settlement: state.settlement,
      // The round's own pinned identity, never the currently loaded constants.
      profile: { id: state.profileId, hash: state.profileHash, version: state.profileVersion },
      actionId: receipt.actionId,
      receipt: receiptView,
    };
  }
}
