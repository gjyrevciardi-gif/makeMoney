import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { CasinoGameType, Prisma, Role } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma.service';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoGameRegistry } from '../../casino-game.registry';
import { LUCKY_LADY_V1 } from './lucky-lady.definition';
import {
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
  type FeatureSpin,
  type LineWin,
  type Rng,
} from './lucky-lady.math';

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
  engineSha256: string;
  plannedFeatureSpins: number;
};

export type GameplayContext = { userId: string; sessionId: string };

const LAUNCH_TTL_MS = 60_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LAUNCH_SCOPE = `game:${LUCKY_LADY_GAME_ID}:play`;
const GAME_VERSION_PREFIX = `${LUCKY_LADY_GAME_ID}.`;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const opaqueToken = () => randomBytes(32).toString('base64url');

/**
 * Reads outside a transaction use the pooled client. The structural shape is
 * identical to a transaction client for the delegates used here.
 */
type ReadClient = Pick<Prisma.TransactionClient, 'casinoRound' | 'casinoRoundAction' | 'wallet'>;
type SnapshotReceipt = { actionId: string | null; event: string | null; delivered: boolean; acked: boolean };

@Injectable()
export class LuckyLadyGameService {
  private readonly rngFactory: () => Rng;
  private readonly hooks: LuckyLadyOptions['hooks'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: CasinoConfigService,
    private readonly registry: CasinoGameRegistry,
    @Optional() @Inject(LUCKY_LADY_OPTIONS) options: LuckyLadyOptions = {},
  ) {
    // Production default: OS CSPRNG, one generator per draw. A deterministic
    // factory can only be supplied by a test that builds this service itself.
    this.rngFactory = options.rngFactory ?? createProductionRng;
    this.hooks = options.hooks ?? {};
  }

  // ---------------------------------------------------------------------------
  // Launch and session capabilities
  // ---------------------------------------------------------------------------

  /** Re-reads the database role: a demoted admin's live token must not play. */
  private async requirePlayer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' });
    if (user.role !== Role.USER) {
      await this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          targetType: 'CASINO_GAME',
          targetId: LUCKY_LADY_GAME_ID,
          action: 'PERMISSION_DENIED',
          result: 'DENIED',
          metadata: { operation: 'LUCKY_LADY_PLAYER_ONLY' },
        },
      });
      throw new ForbiddenException({ code: 'PLAYER_ROLE_REQUIRED', message: 'This game is available to players only.' });
    }
    return user;
  }

  /**
   * Issues one single-use launch capability. Neither the response nor the
   * database ever carries the raw secret twice, and only its hash is stored.
   */
  async issueLaunch(actorId: string) {
    await this.requirePlayer(actorId);
    this.registry.assertEnabled(LUCKY_LADY_GAME_ID);
    await this.configs.assertPlayable(LUCKY_LADY_GAME_ID);

    const token = opaqueToken();
    const expiresAt = new Date(Date.now() + LAUNCH_TTL_MS);
    const launch = await this.prisma.luckyLadyLaunch.create({
      data: { userId: actorId, scope: LAUNCH_SCOPE, tokenHash: sha256(token), expiresAt },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_GAME',
        targetId: LUCKY_LADY_GAME_ID,
        action: 'CASINO_ROUND_STARTED',
        result: 'LAUNCH_ISSUED',
        metadata: { scope: LAUNCH_SCOPE, launchId: launch.id, expiresAt: expiresAt.toISOString() },
      },
    });
    return { token, expiresAt: expiresAt.toISOString(), path: `/launch`, gamePath: `/games/LuckyLadysCharmDX/` };
  }

  /**
   * Exchanges a launch capability exactly once for a bound game session.
   *
   * Consumption is a conditional update, so two simultaneous exchanges cannot
   * both mint a session even without a lock.
   */
  async exchangeLaunch(rawToken: string) {
    if (typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 200 || CONTROL_CHARS.test(rawToken)) {
      throw new BadRequestException({ code: 'INVALID_LAUNCH_TOKEN', message: 'Invalid launch token.' });
    }
    CONTROL_CHARS.lastIndex = 0;
    const tokenHash = sha256(rawToken);
    const launch = await this.prisma.luckyLadyLaunch.findUnique({ where: { tokenHash } });
    if (!launch || launch.scope !== LAUNCH_SCOPE) {
      throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_INVALID', message: 'That launch link is not valid.' });
    }
    if (launch.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'LAUNCH_TOKEN_EXPIRED', message: 'That launch link has expired.' });
    }
    const consumed = await this.prisma.luckyLadyLaunch.updateMany({
      where: { id: launch.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new ConflictException({ code: 'LAUNCH_TOKEN_USED', message: 'That launch link has already been used.' });
    }
    await this.requirePlayer(launch.userId);
    this.registry.assertEnabled(LUCKY_LADY_GAME_ID);
    await this.configs.assertPlayable(LUCKY_LADY_GAME_ID);

    const sessionToken = opaqueToken();
    const session = await this.prisma.luckyLadySession.create({
      data: {
        userId: launch.userId,
        gameId: LUCKY_LADY_GAME_ID,
        tokenHash: sha256(sessionToken),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    await this.prisma.luckyLadyLaunch.update({ where: { id: launch.id }, data: { sessionId: session.id } });
    return { userId: launch.userId, sessionId: session.id, sessionToken };
  }

  /** Validates a gameplay capability and re-checks authorization on every call. */
  async assertSession(rawToken: string) {
    if (typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 200 || CONTROL_CHARS.test(rawToken)) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_INVALID', message: 'Game session required.' });
    }
    CONTROL_CHARS.lastIndex = 0;
    const session = await this.prisma.luckyLadySession.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!session || session.gameId !== LUCKY_LADY_GAME_ID || session.revokedAt) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_INVALID', message: 'Game session required.' });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'GAME_SESSION_EXPIRED', message: 'Your game session expired.' });
    }
    await this.requirePlayer(session.userId);
    this.registry.assertEnabled(LUCKY_LADY_GAME_ID);
    await this.configs.assertPlayable(LUCKY_LADY_GAME_ID);
    await this.prisma.luckyLadySession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return { userId: session.userId, sessionId: session.id };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async settings(userId: string) {
    await this.reconcilePrepared(userId);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    const balance = Number(wallet?.balance ?? 0n);
    return {
      responseEvent: 'getSettings',
      slotLanguage: nativeLanguage(),
      serverResponse: { ...nativeSettings(), Balance: balance },
      recovery: await this.snapshot(userId),
    };
  }

  async update(userId: string) {
    await this.reconcilePrepared(userId);
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      responseEvent: 'error',
      responseType: 'update',
      serverResponse: String(Number(wallet?.balance ?? 0n)),
      recovery: await this.snapshot(userId),
    };
  }

  // ---------------------------------------------------------------------------
  // Gameplay
  // ---------------------------------------------------------------------------

  async handleGameplay(
    context: GameplayContext,
    event: string,
    body: Record<string, unknown>,
    headers: Record<string, string | undefined>,
    requestId: string,
  ) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) {
      throw new BadRequestException({ code: 'REQUEST_ID_REQUIRED', message: 'A request identifier is required.' });
    }
    // Validate the action semantics before anything is replayed: a fractional
    // or unsupported stake must be refused outright rather than rounded into a
    // cached request's semantics.
    const canonical = this.canonicalAction(context.userId, event, body);
    const replay = await this.findReplay(context.userId, requestId, canonical);
    if (replay) return replay;
    // Reconcile durably prepared outcomes before serving any authoritative
    // state, so a reconnect reports the settled round without a reroll.
    await this.reconcilePrepared(context.userId);
    const settled = await this.findReplay(context.userId, requestId, canonical);
    if (settled) return settled;

    switch (event) {
      case 'bet':
        return this.bet(context, body, headers, requestId, canonical);
      case 'freespin':
        return this.freeSpin(context, body, headers, requestId, canonical);
      case 'slotGamble':
        return this.gamble(context, body, headers, requestId, canonical);
      case 'recoveryGamble':
      case 'recoveryCollect':
        return this.recoveryAction(context, event, headers, requestId, canonical);
      default:
        throw new BadRequestException({ code: 'UNSUPPORTED_EVENT', message: 'Unsupported game event.' });
    }
  }

  async acknowledge(userId: string, body: Record<string, unknown>) {
    const actionId = typeof body.actionId === 'string' ? body.actionId : '';
    if (!actionId) return { responseEvent: 'ack', actionId: null, accepted: false, reason: 'missing action id' };
    return this.serialized(userId, async (tx) => {
      const row = await tx.casinoRoundAction.findUnique({ where: { idempotencyKey: this.requestKey(userId, actionId) } });
      if (!row || row.gameId !== LUCKY_LADY_GAME_ID) {
        return { responseEvent: 'ack', actionId, accepted: false, reason: 'unknown action' };
      }
      const latest = await this.latestActionIn(tx, userId);
      if (!latest || latest.idempotencyKey !== row.idempotencyKey) {
        return { responseEvent: 'ack', actionId, accepted: false, reason: 'stale action; a newer result is pending' };
      }
      if (!row.ackedAt) {
        await tx.casinoRoundAction.update({ where: { id: row.id }, data: { ackedAt: new Date() } });
      }
      return { responseEvent: 'ack', actionId, accepted: true };
    });
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
    const prepared = await this.serialized<{ replay?: unknown; conflict?: unknown; row?: { requestKey: string } }>(
      userId,
      async (tx) => {
        const replay = await this.findReplayIn(tx, userId, requestId, canonical);
        if (replay) return { replay };
        const current = await this.currentRoundIn(tx, userId);
        this.assertGuard(headers, current);
        await this.assertReceiptIn(tx, userId);
        await this.assertNoForeignPrepared(tx, userId, requestId);
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
        this.registry.assertEnabled(LUCKY_LADY_GAME_ID);
        const effective = await this.configs.assertPlayable(LUCKY_LADY_GAME_ID);
        const wager = BigInt(units * lines);
        // The operator's configured limits are enforced, not ignored. This game
        // publishes a fixed native ladder, so its spec refuses any candidate
        // that would move those limits away from it.
        if (wager < effective.minStake) {
          throw this.conflict('STAKE_BELOW_MINIMUM', `Minimum stake is ${effective.minStake} points.`);
        }
        if (wager > effective.maxStake) {
          throw this.conflict('STAKE_ABOVE_MAXIMUM', `Maximum stake is ${effective.maxStake} points.`);
        }
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
        // Sufficient balance is checked before any draw: no RNG on a round that
        // cannot be paid for.
        if (wallet.balance < wager) {
          throw new ConflictException({ code: 'INSUFFICIENT_VIRTUAL_BALANCE', message: 'Insufficient virtual points.' });
        }
        const key = this.requestKey(userId, requestId);
        const existing = await tx.luckyLadyPrepared.findUnique({ where: { requestKey: key } });
        if (existing) {
          if (existing.canonical !== canonical) this.conflictSemantics();
          return { row: { requestKey: key } };
        }
        const { round } = generateCompleteRound({ rng: this.rngFactory(), bet: units, lines });
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
          profileId: loadVerifiedMath().profile.id,
          profileHash: loadVerifiedMath().hashes.profileCanonicalHash,
          profileVersion: LUCKY_LADY_PROFILE_VERSION,
          engineSha256: loadVerifiedMath().hashes.engineSha256,
          plannedFeatureSpins: round.feature.spins,
        };
        await tx.luckyLadyPrepared.create({
          data: {
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
            body: body as Prisma.InputJsonValue,
            payload: stateOut as unknown as Prisma.InputJsonValue,
          },
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
    return this.serialized(userId, async (tx) => {
      const replay = await this.findReplayIn(tx, userId, requestId, canonical);
      if (replay) return replay;
      const current = await this.currentRoundIn(tx, userId);
      this.assertGuard(headers, current);
      await this.assertReceiptIn(tx, userId);
      await this.assertNoForeignPrepared(tx, userId, requestId);
      if (!current) throw this.conflict('NO_ACTIVE_FREE_SPIN', 'There is no active free spin.');
      const state = this.stateOf(current);
      if (state.phase !== 'FREE_SPINS') throw this.conflict('NO_ACTIVE_FREE_SPIN', 'There is no active free spin.');
      const units = this.parseLineStake(body);
      const lines = this.parseLines(body);
      if (units !== state.bet || lines !== state.lines) {
        throw this.conflict('FREE_SPIN_BET_LOCKED', 'The free-spin stake is locked to the triggering spin.');
      }
      const next = state.sequence[state.fsIndex];
      if (!next) throw this.conflict('FREE_SPINS_EXHAUSTED', 'The free-spin sequence is exhausted.');

      const native = nativeSpin(next.board, next, { isFree: true, priorPoints: state.bonusWin });
      state.version += 1;
      state.fsIndex += 1;
      if (next.retriggered) state.freeTotal += freeSpinCount();
      state.bonusWin += next.spinWin;
      state.pendingWin = state.bonusWin;
      const finished = state.fsIndex >= state.freeTotal;
      state.phase = finished ? (state.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE') : 'FREE_SPINS';
      if (state.phase === 'IDLE') state.settlement = { collected: true };

      const balance = await this.balanceIn(tx, userId);
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
      await this.persistRound(tx, current, state);
      const response = { responseEvent: 'spin', responseType: 'freespin', serverResponse };
      const full = { ...response, recovery: this.snapshotOf(current.id, state, this.deliveringView(requestId, 'freespin'), balance) };
      return this.bookAction(tx, { userId, roundId: current.id, event: 'freespin', requestId, canonical, response: full });
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
    const prepared = await this.serialized<{ replay?: unknown; row?: { requestKey: string } }>(userId, async (tx) => {
      const replay = await this.findReplayIn(tx, userId, requestId, canonical);
      if (replay) return { replay };
      const current = await this.currentRoundIn(tx, userId);
      this.assertGuard(headers, current);
      await this.assertReceiptIn(tx, userId);
      // A prepared outcome for another request blocks this one: two distinct
      // gambles may not both draw against the same round version.
      await this.assertNoForeignPrepared(tx, userId, requestId);
      if (!current) throw this.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
      const state = this.stateOf(current);
      if (state.phase !== 'PENDING_WIN' && state.phase !== 'GAMBLE') {
        throw this.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
      }
      const choice = String(body.gambleChoice ?? '').toLowerCase();
      if (choice !== 'red' && choice !== 'black') {
        throw this.conflict('INVALID_GAMBLE_CHOICE', 'Choose red or black.');
      }
      const key = this.requestKey(userId, requestId);
      const existing = await tx.luckyLadyPrepared.findUnique({ where: { requestKey: key } });
      if (existing) {
        if (existing.canonical !== canonical) this.conflictSemantics();
        return { row: { requestKey: key } };
      }
      const draw = drawGamble({ rng: this.rngFactory(), choice });
      await tx.luckyLadyPrepared.create({
        data: {
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
          body: body as Prisma.InputJsonValue,
          payload: draw as unknown as Prisma.InputJsonValue,
        },
      });
      return { row: { requestKey: key } };
    });
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
    return this.serialized(userId, async (tx) => {
      const key = this.requestKey(userId, requestId);
      const replay = await this.findReplayIn(tx, userId, requestId, canonical);
      if (replay) {
        await tx.luckyLadyPrepared.deleteMany({ where: { requestKey: key } });
        return replay;
      }
      const prepared = await tx.luckyLadyPrepared.findUnique({ where: { requestKey: key } });
      if (!prepared) throw this.conflict('OUTCOME_NOT_PREPARED', 'The prepared outcome is missing.');
      if (prepared.canonical !== canonical) this.conflictSemantics();

      // A prepared action is only ever applied to the exact round state it was
      // drawn against. Anything else means a newer authoritative state exists
      // and this stored outcome is stale.
      const current = await this.currentRoundIn(tx, userId);
      const currentId = current ? current.id : 'none';
      const currentState = current ? this.stateOf(current) : null;
      const currentVersion = currentState ? currentState.version : 1;
      if (prepared.originRoundId !== currentId || prepared.originVersion !== currentVersion) {
        throw this.conflict('STALE_PREPARED_ACTION', 'A newer round state superseded this action.');
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
        const round = await this.createRound(tx, userId, state);
        await this.moveWallet(tx, {
          walletId: wallet.id,
          userId,
          roundId: round.id,
          direction: 'debit',
          amount: wager,
          reason: 'Lucky Lady wager',
          key: `casino:lucky-lady:bet:${round.id}`,
          sessionId,
          actionId,
        });
        // Fault-injection point: the wallet write above is inside this
        // transaction, so a throw here must leave no debit and no orphan row.
        await this.hooks?.afterDebit?.({ requestKey: key, kind });
        state.freeBalance = await this.balanceIn(tx, userId);
        const phase: LuckyLadyPhase = state.freeTotal > 0
          ? 'FREE_SPINS'
          : (state.pendingWin > 0 ? 'PENDING_WIN' : 'IDLE');
        state.phase = phase;
        if (phase === 'IDLE') state.settlement = { collected: true };
        const spin = nativeSpin(state.main.board, state.main, { isFree: false });
        const balance = await this.balanceIn(tx, userId);
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
        await this.persistRound(tx, round, state);
        const response = { responseEvent: 'spin', responseType: 'bet', serverResponse };
        const full = { ...response, recovery: this.snapshotOf(round.id, state, this.deliveringView(requestId, 'bet'), balance) };
        const stored = await this.bookAction(tx, { userId, roundId: round.id, event: 'bet', requestId, canonical, response: full });
        await tx.luckyLadyPrepared.deleteMany({ where: { requestKey: key } });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            targetType: 'CASINO_ROUND',
            targetId: round.id,
            action: 'CASINO_ROUND_STARTED',
            result: phase,
            metadata: {
              gameId: LUCKY_LADY_GAME_ID,
              profileHash: state.profileHash,
              stake: wager.toString(),
              pendingWin: state.pendingWin,
            },
          },
        });
        return stored;
      }

      if (!current) throw this.conflict('NOTHING_TO_GAMBLE', 'There is nothing to gamble.');
      if (prepared.originPhase !== currentState?.phase) {
        throw this.conflict('STALE_PREPARED_ACTION', 'A newer round state superseded this action.');
      }
      const state = currentState as LuckyLadyState;
      const draw = prepared.payload as unknown as { win: boolean; dealerCard: string };
      const stake = state.pendingWin;
      const balanceBefore = this.toSafeNumber(wallet.balance, 'wallet balance');
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
        afterBalance: await this.balanceIn(tx, userId),
        Balance: balanceBefore,
      };
      // The board the client must be able to redraw is the last *spin* result;
      // the gamble presentation is kept separately so a refresh after a gamble
      // still restores the exact reels.
      state.lastGamble = { responseEvent: 'gambleResult', serverResponse };
      await this.persistRound(tx, current, state);
      const response = { responseEvent: 'gambleResult', serverResponse };
      const full = {
        ...response,
        recovery: this.snapshotOf(current.id, state, this.deliveringView(requestId, 'slotGamble'), serverResponse.afterBalance),
      };
      const stored = await this.bookAction(tx, { userId, roundId: current.id, event: 'slotGamble', requestId, canonical, response: full });
      await tx.luckyLadyPrepared.deleteMany({ where: { requestKey: key } });
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
    return this.serialized(userId, async (tx) => {
      const replay = await this.findReplayIn(tx, userId, requestId, canonical);
      if (replay) return replay;
      const current = await this.currentRoundIn(tx, userId);
      this.assertGuard(headers, current);
      await this.assertReceiptIn(tx, userId);
      await this.assertNoForeignPrepared(tx, userId, requestId);
      if (!current) throw this.conflict('NO_ROUND', 'There is no round to recover.');
      const state = this.stateOf(current);
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });

      if (event === 'recoveryGamble') {
        if (state.phase !== 'PENDING_WIN' || state.pendingWin <= 0) {
          throw this.conflict('NO_PENDING_GAMBLE', 'There is no pending win to gamble.');
        }
        state.phase = 'GAMBLE';
        state.version += 1;
      } else {
        if (state.phase !== 'PENDING_WIN' && state.phase !== 'GAMBLE') {
          throw this.conflict('NOTHING_TO_COLLECT', 'There is nothing to collect.');
        }
        const pending = state.pendingWin;
        if (pending > 0) {
          // Exactly one credit for the whole feature, keyed by round.
          await this.moveWallet(tx, {
            walletId: wallet.id,
            userId,
            roundId: current.id,
            direction: 'credit',
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
      await this.persistRound(tx, current, state);
      const full = {
        responseEvent: 'recoveryAck',
        recovery: this.snapshotOf(current.id, state, this.deliveringView(requestId, event), await this.balanceIn(tx, userId)),
      };
      return this.bookAction(tx, { userId, roundId: current.id, event, requestId, canonical, response: full });
    });
  }

  // ---------------------------------------------------------------------------
  // Durable prepared-outcome reconciliation
  // ---------------------------------------------------------------------------

  /** Settles stored outcomes without drawing. Called before any state is read. */
  async reconcilePrepared(userId: string) {
    const rows = await this.prisma.luckyLadyPrepared.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { requestKey: true, kind: true },
    });
    for (const row of rows) {
      const requestId = this.unscopedRequestId(userId, row.requestKey);
      try {
        await this.settlePrepared(userId, row.kind === 'gamble' ? 'gamble' : 'bet', requestId, await this.canonicalOfPrepared(row.requestKey));
      } catch (error) {
        if (this.isStalePrepared(error)) {
          // A superseded outcome can never be applied. It is dropped in its own
          // transaction so it cannot poison that request identity forever.
          await this.discardStalePrepared(userId, row.requestKey);
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

  /**
   * Removes a superseded prepared outcome in its own transaction. The failed
   * settlement transaction rolled back, so the delete has to commit separately.
   */
  private async discardStalePrepared(userId: string, requestKey: string) {
    await this.serialized(userId, async (tx) => {
      await tx.luckyLadyPrepared.deleteMany({ where: { requestKey } });
    });
  }

  /** Settlement entry point for a caller that owns the request identity. */
  private async settlePreparedOrReject(userId: string, kind: 'bet' | 'gamble', requestId: string, canonical: string) {
    try {
      return await this.settlePrepared(userId, kind, requestId, canonical);
    } catch (error) {
      if (this.isStalePrepared(error)) {
        await this.discardStalePrepared(userId, this.requestKey(userId, requestId));
      }
      throw error;
    }
  }

  private async canonicalOfPrepared(requestKey: string) {
    const row = await this.prisma.luckyLadyPrepared.findUnique({ where: { requestKey }, select: { canonical: true } });
    return row?.canonical ?? '';
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  private requestKey(userId: string, requestId: string) {
    return `${userId}:${requestId}`;
  }

  private unscopedRequestId(userId: string, requestKey: string) {
    const prefix = `${userId}:`;
    return requestKey.startsWith(prefix) ? requestKey.slice(prefix.length) : requestKey;
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  private conflictSemantics(): never {
    throw this.conflict('IDEMPOTENCY_KEY_CONFLICT', 'This request identifier was already used for a different action.');
  }

  /**
   * Canonical, order-independent semantics of one validated action.
   *
   * The stake and line count are validated *here*, before any replay lookup, so
   * a fractional or unsupported value can never be rounded into the semantics
   * of a cached request.
   */
  private canonicalAction(userId: string, event: string, body: Record<string, unknown>) {
    const action: Record<string, unknown> = { event, player: userId };
    if (event === 'bet' || event === 'freespin') {
      action.stakeUnits = this.parseLineStake(body);
      action.lines = this.parseLines(body);
    }
    if (event === 'slotGamble') action.choice = String(body.gambleChoice ?? '').toLowerCase();
    return JSON.stringify(action, Object.keys(action).sort());
  }

  /**
   * The native ladder is whole platform points: 1/2/5/10/20 per line, so the
   * displayed total stake (per line x ten lines) is exactly the point amount
   * the ledger debits. Nothing here is scaled or rounded.
   */
  private parseLineStake(body: Record<string, unknown>) {
    const value = Number(body.slotBet);
    if (!Number.isFinite(value)) {
      throw this.conflict('UNSUPPORTED_STAKE', 'Choose one of the native stake values.');
    }
    const units = Math.round(value);
    // Tolerate binary-float noise on a whole number, but reject a genuinely
    // fractional stake instead of rounding it to a nearby native value.
    if (!Number.isSafeInteger(units) || Math.abs(value - units) > 1e-9) {
      throw this.conflict('UNSUPPORTED_STAKE_PRECISION', 'Use a native stake value.');
    }
    if (units <= 0) {
      throw this.conflict('UNSUPPORTED_STAKE', 'Choose one of the native stake values.');
    }
    try {
      assertLineStake(units);
    } catch (error) {
      throw this.conflict((error as { code?: string }).code ?? 'UNSUPPORTED_STAKE', (error as Error).message);
    }
    return units;
  }

  private parseLines(body: Record<string, unknown>) {
    const lines = Number(body.slotLines);
    try {
      assertSupportedLines(lines);
    } catch (error) {
      throw this.conflict((error as { code?: string }).code ?? 'UNSUPPORTED_LINES', (error as Error).message);
    }
    return lines;
  }

  /** One transaction-scoped advisory lock serializes a player's whole game. */
  private async lock(tx: Prisma.TransactionClient, userId: string) {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`casino:${LUCKY_LADY_GAME_ID}`}), hashtext(${userId}))`);
  }

  private async serialized<T>(userId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, userId);
        return work(tx);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  private async balanceIn(tx: Prisma.TransactionClient, userId: string) {
    const wallet = await tx.wallet.findUnique({ where: { userId }, select: { balance: true } });
    return this.toSafeNumber(wallet?.balance ?? 0n, 'wallet balance');
  }

  /**
   * Exact BigInt -> native number conversion at the protocol boundary.
   *
   * The recovered client speaks JSON numbers; a value the platform cannot
   * represent exactly is refused rather than silently rounded.
   */
  private toSafeNumber(value: bigint, label: string) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
      throw this.conflict('BALANCE_OUT_OF_RANGE', `The ${label} cannot be represented exactly.`);
    }
    return Number(value);
  }

  private currentRoundWhere(userId: string) {
    return { userId, gameVersion: { startsWith: GAME_VERSION_PREFIX } };
  }

  private async currentRoundIn(tx: Prisma.TransactionClient, userId: string) {
    return tx.casinoRound.findFirst({
      where: this.currentRoundWhere(userId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Reads a round's pinned state and refuses to serve it under different maths.
   *
   * A profile change (or a tampered file) must fail closed rather than quietly
   * re-price a round that was already played.
   */
  private stateOf(round: { privateState: Prisma.JsonValue }) {
    const state = round.privateState as unknown as LuckyLadyState;
    const { profile } = loadVerifiedMath();
    if (state.profileId !== profile.id
      || state.profileHash !== profile.canonicalHash
      || state.profileVersion !== LUCKY_LADY_PROFILE_VERSION) {
      throw this.conflict('ROUND_MATH_MISMATCH', 'This round was created under different game mathematics.');
    }
    return state;
  }

  /**
   * A prepared row blocks any other mutation until its own request settles it,
   * which is what keeps two different actions from interleaving.
   */
  private async assertNoForeignPrepared(tx: Prisma.TransactionClient, userId: string, requestId: string) {
    const row = await tx.luckyLadyPrepared.findFirst({ where: { userId }, select: { requestKey: true } });
    if (row && row.requestKey !== this.requestKey(userId, requestId)) {
      throw this.conflict('SETTLEMENT_PENDING', 'A prepared settlement is pending for another request.');
    }
  }

  private assertGuard(
    headers: Record<string, string | undefined>,
    round: { id: string; privateState: Prisma.JsonValue } | null,
  ) {
    const expected = round
      ? { version: String(this.stateOf(round).version), round: round.id }
      : { version: '1', round: 'none' };
    const version = headers['x-pilot-version'];
    const roundHeader = headers['x-pilot-round'];
    if (version === undefined || roundHeader === undefined) {
      throw this.conflict('ROUND_GUARD_REQUIRED', 'Round guard headers are required.');
    }
    if (String(version) !== expected.version || String(roundHeader) !== expected.round) {
      throw this.conflict('STALE_ROUND', 'This action refers to a stale round or version.');
    }
  }

  private async latestActionIn(tx: Prisma.TransactionClient, userId: string) {
    // `seq` is a database-generated monotonic sequence, so the "latest
    // authoritative action" can never be decided by a random UUID tie-break.
    return tx.casinoRoundAction.findFirst({
      where: { userId, gameId: LUCKY_LADY_GAME_ID },
      orderBy: [{ seq: 'desc' }],
    });
  }

  /**
   * Presentation gate. Financial settlement may already be durable, but no
   * further gameplay action may execute until the client confirmed it rendered
   * the previous authoritative result.
   */
  private async assertReceiptIn(tx: Prisma.TransactionClient, userId: string) {
    const latest = await this.latestActionIn(tx, userId);
    if (latest && !latest.ackedAt) {
      throw this.conflict('ACK_REQUIRED', 'The previous result has not been acknowledged.');
    }
  }

  private async findReplay(userId: string, requestId: string, canonical: string) {
    return this.findReplayIn(this.prisma as unknown as ReadClient, userId, requestId, canonical);
  }

  private async findReplayIn(
    db: ReadClient,
    userId: string,
    requestId: string,
    canonical: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await db.casinoRoundAction.findUnique({ where: { idempotencyKey: this.requestKey(userId, requestId) } });
    if (!row) return null;
    if (row.gameId !== LUCKY_LADY_GAME_ID) return null;
    if (row.canonical !== canonical) this.conflictSemantics();
    return row.payload as unknown as Record<string, unknown>;
  }

  /**
   * Writes the durable response and returns the stored document.
   *
   * Returning the database's own JSON, rather than the object this process
   * just built, is what makes a replay byte-stable: the first delivery and
   * every later replay serialize the same stored value.
   */
  private async bookAction(
    tx: Prisma.TransactionClient,
    params: { userId: string; roundId: string; event: string; requestId: string; canonical: string; response: Record<string, unknown> },
  ): Promise<Record<string, unknown>> {
    const key = this.requestKey(params.userId, params.requestId);
    await tx.casinoRoundAction.create({
      data: {
        roundId: params.roundId,
        userId: params.userId,
        action: params.event,
        payload: params.response as unknown as Prisma.InputJsonValue,
        idempotencyKey: key,
        gameId: LUCKY_LADY_GAME_ID,
        canonical: params.canonical,
        // The delivery marker records the attempt made by this response; the
        // receipt gate only ever trusts `ackedAt`.
        deliveredAt: new Date(),
      },
    });
    const stored = await tx.casinoRoundAction.findUniqueOrThrow({
      where: { idempotencyKey: key },
      select: { payload: true },
    });
    return stored.payload as unknown as Record<string, unknown>;
  }

  private async createRound(tx: Prisma.TransactionClient, userId: string, state: LuckyLadyState) {
    // Always opened as OPEN; the caller settles the terminal columns in the
    // same transaction once the wallet movement has happened.
    const stateForRow = this.roundColumns(state, false);
    // Outcome entropy is the OS CSPRNG (see createProductionRng); this value is
    // an opaque per-round reference recorded for auditability, not a seed that
    // reproduces the result.
    const roundReference = randomBytes(32).toString('hex');
    return tx.casinoRound.create({
      data: {
        id: state.roundId,
        userId,
        gameType: CasinoGameType.SLOTS,
        gameVersion: LUCKY_LADY_V1.version,
        status: stateForRow.status,
        stake: BigInt(state.bet * state.lines),
        multiplier: null,
        payout: 0n,
        serverSeed: roundReference,
        serverSeedHash: sha256(roundReference),
        clientSeed: `lucky-lady:${state.roundId}`,
        nonce: 0,
        publicState: stateForRow.publicState as unknown as Prisma.InputJsonValue,
        privateState: state as unknown as Prisma.InputJsonValue,
        idempotencyKey: `casino:lucky-lady:round:${state.roundId}`,
        settledAt: null,
      },
    });
  }

  private async persistRound(
    tx: Prisma.TransactionClient,
    round: { id: string; status: string; settledAt: Date | null },
    state: LuckyLadyState,
  ) {
    const terminal = state.phase === 'IDLE';
    const columns = this.roundColumns(state, terminal);
    await tx.casinoRound.update({
      where: { id: round.id },
      data: {
        status: columns.status,
        payout: BigInt(state.payout),
        publicState: columns.publicState as unknown as Prisma.InputJsonValue,
        privateState: state as unknown as Prisma.InputJsonValue,
        settledAt: terminal ? (round.settledAt ?? new Date()) : null,
      },
    });
  }

  /**
   * Round status columns. A round that actually credited the wallet is
   * CASHED_OUT; a round that closed with nothing credited - including a
   * gambled-away pending win - is LOST with a zero payout, which is exactly
   * what the database's `CasinoRound_lost_zero_payout_check` requires.
   */
  private roundColumns(state: LuckyLadyState, terminal: boolean) {
    const publicState = { gameId: LUCKY_LADY_GAME_ID, phase: state.phase, version: state.version };
    if (!terminal) return { status: 'OPEN' as const, publicState };
    return {
      status: (state.payout > 0 ? 'CASHED_OUT' : 'LOST') as 'CASHED_OUT' | 'LOST',
      publicState,
    };
  }

  /**
   * The single wallet mutation path for this game, in the platform's existing
   * ledger convention: one immutable LedgerEntry plus one game-domain
   * CasinoTransaction, keyed so a retry can never move money twice.
   *
   * The wallet row is locked for the duration of the transaction, so the exact
   * before/after recorded on the ledger entry stays true even when another
   * platform game is spending the same wallet concurrently.
   */
  private async moveWallet(
    tx: Prisma.TransactionClient,
    params: {
      walletId: string;
      userId: string;
      roundId: string;
      direction: 'debit' | 'credit';
      amount: bigint;
      reason: string;
      key: string;
      sessionId: string | null;
      actionId: string;
    },
  ) {
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: params.key } });
    if (existing) return;
    if (params.amount <= 0n) throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Invalid amount.' });

    const locked = await tx.$queryRaw<Array<{ balance: bigint }>>(
      Prisma.sql`SELECT "balance" FROM "Wallet" WHERE "id" = ${params.walletId}::uuid FOR UPDATE`,
    );
    if (locked.length !== 1) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
    }
    const before = locked[0].balance;
    const after = params.direction === 'debit' ? before - params.amount : before + params.amount;
    if (params.direction === 'debit' && before < params.amount) {
      throw new ConflictException({ code: 'INSUFFICIENT_VIRTUAL_BALANCE', message: 'Insufficient virtual points.' });
    }
    if (after < 0n) {
      throw new ConflictException({ code: 'INSUFFICIENT_VIRTUAL_BALANCE', message: 'Insufficient virtual points.' });
    }
    await tx.wallet.update({ where: { id: params.walletId }, data: { balance: after } });

    await tx.ledgerEntry.create({
      data: {
        walletId: params.walletId,
        type: params.direction === 'debit' ? 'CASINO_BET' : 'CASINO_WIN',
        amount: params.direction === 'debit' ? -params.amount : params.amount,
        reason: params.reason,
        actorId: params.userId,
        relatedCasinoRoundId: params.roundId,
        idempotencyKey: params.key,
        gameSessionId: params.sessionId,
        actionId: params.actionId,
        balanceBefore: before,
        balanceAfter: after,
      },
    });
    await tx.casinoTransaction.create({
      data: {
        roundId: params.roundId,
        userId: params.userId,
        type: params.direction === 'debit' ? 'BET' : 'WIN',
        amount: params.direction === 'debit' ? -params.amount : params.amount,
        idempotencyKey: params.key,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Snapshot / protocol projection
  // ---------------------------------------------------------------------------

  private deliveringView(requestId: string, event: string) {
    return { actionId: requestId, event, delivered: false, acked: false };
  }

  private async snapshot(userId: string) {
    const round = await this.prisma.casinoRound.findFirst({
      where: this.currentRoundWhere(userId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return this.snapshotIn(this.prisma as unknown as ReadClient, userId, round);
  }

  private async snapshotIn(
    db: ReadClient,
    userId: string,
    round: { id: string; privateState: Prisma.JsonValue } | null,
  ) {
    const latest = await db.casinoRoundAction.findFirst({
      where: { userId, gameId: LUCKY_LADY_GAME_ID },
      orderBy: [{ seq: 'desc' }],
    });
    const receipt: SnapshotReceipt = latest
      ? {
        actionId: this.unscopedRequestId(userId, latest.idempotencyKey),
        event: latest.action,
        delivered: latest.deliveredAt !== null,
        acked: latest.ackedAt !== null,
      }
      : { actionId: null, event: null, delivered: false, acked: true };
    const wallet = await db.wallet.findUnique({ where: { userId }, select: { balance: true } });
    return this.snapshotOf(
      round?.id ?? null,
      round ? this.stateOf(round) : null,
      receipt,
      this.toSafeNumber(wallet?.balance ?? 0n, 'wallet balance'),
    );
  }

  private snapshotOf(
    roundId: string | null,
    state: LuckyLadyState | null,
    receipt: SnapshotReceipt,
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
