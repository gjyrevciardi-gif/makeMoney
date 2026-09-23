import { createHash, randomUUID } from "node:crypto";
import type { GameConfig } from "@slot-skills/schema";
import { canonicalJson } from "@slot-skills/schema";
import { CryptoRngProvider, type RngProvider } from "@slot-skills/math";
import type { FeatureState } from "@slot-skills/features";
import {
  DefaultGameEngine,
  jurisdictionProfiles,
  roundCostUnits,
  type GameEngine,
  type GameRoundResult,
  type InternalContinuation,
} from "@slot-skills/runtime";
import {
  isAtomicRoundProvider,
  type AtomicRoundProvider,
  type AuditRecord,
  type HostProviders,
  type IdempotencyScope,
} from "./providers.js";

export interface SpinInput {
  gameId: string;
  playerId: string;
  betUnits: string;
  idempotencyKey: string;
  purchasedFeatureId?: string;
  anteBet?: boolean;
  autoplay?: boolean;
}

export interface ActionInput {
  roundId: string;
  playerId: string;
  actionId: string;
  choiceId: string;
  idempotencyKey: string;
  /** Optional; derived from the stored round when the caller does not know it. */
  gameId?: string;
}

export interface GameHostOptions {
  games: readonly GameConfig[];
  providers: HostProviders;
  rng?: RngProvider;
  engine?: GameEngine;
  production?: boolean;
  now?: () => number;
}

/** Binds an idempotency key to the exact request it was first used with. */
function requestFingerprint(operation: string, payload: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson({ operation, payload })).digest("hex");
}

function presentationState(state: FeatureState): FeatureState {
  const publicState = structuredClone(state);
  if (publicState.bookOfRa) {
    delete publicState.bookOfRa.gambleColours;
    delete publicState.bookOfRa.gambleColor;
  }
  return publicState;
}

/** Keep private persisted state separate from every host/HTTP response. */
function presentationResult(result: GameRoundResult): GameRoundResult {
  if (result.gameId !== "book-of-the-sands") return result;
  const { outcomeHash: _privateHash, ...publicResult } = structuredClone(result);
  publicResult.featureState = presentationState(publicResult.featureState);
  publicResult.draws = [];
  // A hash of hidden colours would itself permit a tiny brute-force search.
  return { ...publicResult, outcomeHash: createHash("sha256").update(canonicalJson(publicResult)).digest("hex") };
}

/**
 * Reference game host.
 *
 * It owns the orchestration around one round — validation, jurisdiction, cycle
 * limits, one stake per round, exactly-once settlement, scoped idempotency —
 * and delegates every outcome decision to the runtime engine. It is a
 * developer harness: the platform's Book of Ra adapter is the authenticated,
 * PostgreSQL-backed production path.
 *
 * Invariants the host enforces:
 * - A new paid round is refused while an action is pending, so an unresolved
 *   gamble can never be overwritten by a second paid spin.
 * - One round, one transaction: stake, award, round, continuation, feature
 *   state and the idempotency record commit together when the provider set can
 *   offer a single-transaction writer.
 * - Idempotency keys are scoped to player, game and operation and bound to the
 *   request body; a reused key with different parameters is refused.
 */
export class ReferenceGameHost {
  readonly games: ReadonlyMap<string, GameConfig>;
  readonly providers: HostProviders;
  readonly rng: RngProvider;
  readonly engine: GameEngine;
  readonly production: boolean;
  readonly now: () => number;
  readonly atomic: AtomicRoundProvider | undefined;

  constructor(options: GameHostOptions) {
    this.games = new Map(options.games.map((game) => [game.id, game]));
    this.providers = options.providers;
    this.rng = options.rng ?? new CryptoRngProvider();
    this.engine = options.engine ?? new DefaultGameEngine();
    this.production = options.production ?? false;
    this.now = options.now ?? Date.now;
    this.atomic = options.providers.atomic
      ?? (isAtomicRoundProvider(options.providers.wallet) ? options.providers.wallet : undefined)
      ?? (isAtomicRoundProvider(options.providers.rounds) ? options.providers.rounds : undefined);
    if (this.production && !this.rng.production) throw new Error(`Test RNG ${this.rng.id} cannot run in production mode`);
  }

  /**
   * Replays a stored response for the same scoped key.
   *
   * The scope keeps one player's key away from another player's round; the
   * fingerprint refuses a key that comes back with a different body instead of
   * answering it with the earlier result.
   */
  private async replay(scope: IdempotencyScope, fingerprint: string): Promise<GameRoundResult | undefined> {
    const existing = await this.providers.rounds.getIdempotent(scope);
    if (!existing) return undefined;
    if (existing.fingerprint !== fingerprint) {
      throw new Error("IDEMPOTENCY_KEY_CONFLICT: this request identifier was already used with different parameters");
    }
    return presentationResult(existing.result);
  }

  async spin(input: SpinInput): Promise<GameRoundResult> {
    if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required");
    const game = this.games.get(input.gameId);
    if (!game) throw new Error(`Unknown game: ${input.gameId}`);
    if (game.id === "book-of-the-sands" && !this.atomic) throw new Error("Book requires atomic round persistence");

    const scope: IdempotencyScope = {
      playerId: input.playerId,
      gameId: game.id,
      operation: "spin",
      requestKey: input.idempotencyKey,
    };
    const fingerprint = requestFingerprint("spin", {
      gameId: game.id,
      betUnits: input.betUnits,
      purchasedFeatureId: input.purchasedFeatureId ?? null,
      anteBet: input.anteBet === true,
      autoplay: input.autoplay === true,
    });
    const replay = await this.replay(scope, fingerprint);
    if (replay) return replay;

    const session = await this.providers.sessions.get(input.playerId);
    if (session.jurisdiction !== game.jurisdiction.profileId) throw new Error(`Session jurisdiction ${session.jurisdiction} cannot play ${game.jurisdiction.profileId}`);
    const profile = jurisdictionProfiles[game.jurisdiction.profileId as keyof typeof jurisdictionProfiles];
    if (!profile) throw new Error(`Unknown jurisdiction profile: ${game.jurisdiction.profileId}`);
    const bet = BigInt(input.betUnits);
    if (bet <= 0n || (game.id !== "book-of-the-sands" && bet > profile.maxStakeUnits(session))) throw new Error(`Bet is outside the permitted range for age band ${session.ageBand}`);
    const now = this.now();
    const nextAllowed = await this.providers.rounds.nextAllowedAt(input.playerId, game.id);
    if (now < nextAllowed) throw new Error(`Next game cycle is not permitted until ${new Date(nextAllowed).toISOString()}`);

    // An unresolved action owns this player's feature state; a second paid
    // round would start from a stale snapshot and could double-settle a win.
    const open = await this.providers.rounds.getOpenRound(input.playerId, game.id);
    if (open) {
      throw new Error(`ACTION_PENDING: resolve the pending ${open.continuation.action.featureId} action on round ${open.result.roundId} first`);
    }

    const roundId = randomUUID();
    const featureState = await this.providers.rounds.getFeatureState(input.playerId, game.id);
    const freeGameActive = game.id === "book-of-the-sands"
      && Boolean(featureState.bookOfRa && featureState.bookOfRa.freeSpinsRemaining > 0);
    const costUnits = freeGameActive ? 0n : roundCostUnits(game, {
      betUnits: input.betUnits,
      ...(input.purchasedFeatureId ? { purchasedFeatureId: input.purchasedFeatureId } : {}),
      ...(input.anteBet ? { anteBet: true } : {}),
    });
    if (game.id === "book-of-the-sands" && costUnits > profile.maxStakeUnits(session)) {
      throw new Error("Total Book stake is outside the permitted range");
    }

    // RNG, board and payout are resolved before anything is written, so a
    // failed transaction discards the outcome instead of leaving it half
    // persisted. A pending win is withheld until the ladder resolves.
    const computation = await this.engine.spin(game, {
      roundId, playerId: input.playerId, betUnits: input.betUnits, featureState,
      ...(input.purchasedFeatureId ? { purchasedFeatureId: input.purchasedFeatureId } : {}),
      ...(input.anteBet ? { anteBet: true } : {}),
      ...(input.autoplay ? { autoplay: true } : {}),
    }, this.rng);
    let result = computation.result;
    const awardUnits = result.complete ? BigInt(result.totalWinUnits) : 0n;
    const audit: AuditRecord = {
      at: new Date(now).toISOString(),
      type: "round-created",
      playerId: input.playerId,
      roundId,
      gameId: game.id,
      payload: {
        outcomeHash: result.outcomeHash,
        mathVersion: game.version,
        rng: this.rng.id,
        costUnits: costUnits.toString(),
        awardUnits: awardUnits.toString(),
        pending: !result.complete,
      },
    };

    try {
      if (this.atomic) {
        result = await this.atomic.commitRound({
          playerId: input.playerId,
          gameId: game.id,
          roundId,
          costUnits: costUnits.toString(),
          awardUnits: awardUnits.toString(),
          state: result.featureState as FeatureState,
          expectedState: featureState,
          result,
          ...(computation.continuation ? { continuation: computation.continuation } : {}),
          idempotency: { ...scope, fingerprint },
          audit,
        });
      } else {
        await this.providers.wallet.reserve(input.playerId, roundId, costUnits.toString());
        await this.providers.rounds.saveFeatureState(input.playerId, game.id, result.featureState);
        await this.providers.rounds.saveRound(result, computation.continuation);
        await this.providers.rounds.saveIdempotent(scope, result, fingerprint);
        if (result.complete) await this.providers.wallet.settle(roundId, awardUnits.toString());
        await this.providers.audit.append(audit);
      }
      await this.providers.rounds.setNextAllowedAt(input.playerId, game.id, now + profile.minimumCycleMs);
      if (game.features.some((feature) => feature.enabled && feature.id === "progressive-jackpot")) {
        await this.providers.jackpot.contribute(`${game.id}:progressive`, roundId, (bet / 100n).toString());
      }
      return presentationResult(result);
    } catch (error) {
      if (!this.atomic) await this.providers.wallet.rollback(roundId);
      await this.providers.audit.append({
        at: new Date(now).toISOString(),
        type: "round-failed",
        playerId: input.playerId,
        roundId,
        gameId: game.id,
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  /**
   * Resolves a pending action exactly once.
   *
   * The engine decides the outcome; the host only persists it. A multi-step
   * action (Book of Ra's five-attempt gamble ladder) returns the continuation
   * for the next attempt, which replaces the resolved one in the same
   * transaction so a retry cannot resolve an attempt twice.
   */
  async resolveAction(input: ActionInput): Promise<GameRoundResult> {
    if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required");
    const known = await this.providers.rounds.getRound(input.roundId);
    const gameId = input.gameId ?? known?.gameId;
    if (!gameId) throw new Error(`Unknown round: ${input.roundId}`);
    if (gameId === "book-of-the-sands" && !this.atomic) throw new Error("Book requires atomic round persistence");
    const scope: IdempotencyScope = {
      playerId: input.playerId,
      gameId,
      operation: "action",
      requestKey: input.idempotencyKey,
    };
    const fingerprint = requestFingerprint("action", {
      roundId: input.roundId,
      actionId: input.actionId,
      choiceId: input.choiceId,
    });
    const replay = await this.replay(scope, fingerprint);
    if (replay) return replay;

    const continuation = await this.providers.rounds.getContinuation(input.roundId);
    if (!continuation) throw new Error(`No pending action for ${input.roundId}`);
    if (continuation.baseResult.playerId !== input.playerId) throw new Error("Pending action belongs to another player");

    const stepped: { result: GameRoundResult; continuation?: InternalContinuation } = this.engine.resolveActionStep
      ? this.engine.resolveActionStep(continuation, input.actionId, input.choiceId)
      : { result: this.engine.resolveAction(continuation, input.actionId, input.choiceId) };
    let result = stepped.result;
    const awardUnits = result.complete ? BigInt(result.totalWinUnits) : 0n;
    const audit: AuditRecord = {
      at: new Date(this.now()).toISOString(),
      type: "round-action-resolved",
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: result.gameId,
      payload: {
        actionId: input.actionId,
        choiceId: input.choiceId,
        outcomeHash: result.outcomeHash,
        awardUnits: awardUnits.toString(),
        pending: !result.complete,
      },
    };
    if (this.atomic) {
      result = await this.atomic.commitRound({
        playerId: input.playerId,
        gameId: result.gameId,
        roundId: input.roundId,
        awardUnits: awardUnits.toString(),
        state: result.featureState as FeatureState,
        expectedState: continuation.baseResult.featureState,
        result,
        ...(stepped.continuation ? { continuation: stepped.continuation } : {}),
        idempotency: { ...scope, fingerprint },
        audit,
      });
    } else {
      if (result.complete) await this.providers.wallet.settle(input.roundId, awardUnits.toString());
      await this.providers.rounds.saveFeatureState(input.playerId, result.gameId, result.featureState);
      await this.providers.rounds.saveRound(result, stepped.continuation);
      await this.providers.rounds.saveIdempotent(scope, result, fingerprint);
      await this.providers.audit.append(audit);
    }
    return presentationResult(result);
  }

  async round(roundId: string): Promise<GameRoundResult> {
    const result = await this.providers.rounds.getRound(roundId);
    if (!result) throw new Error(`Unknown round: ${roundId}`);
    return presentationResult(result);
  }

  /**
   * Everything a refresh needs: the persisted feature state and, if an action
   * is still unresolved, the round that owns it. Nothing is re-rolled and
   * nothing is re-settled here.
   */
  async currentState(playerId: string, gameId: string): Promise<{
    playerId: string;
    gameId: string;
    featureState: Awaited<ReturnType<HostProviders["rounds"]["getFeatureState"]>>;
    pendingRound?: GameRoundResult;
    pendingActionId?: string;
  }> {
    if (!this.games.has(gameId)) throw new Error(`Unknown game: ${gameId}`);
    const open = await this.providers.rounds.getOpenRound(playerId, gameId);
    const featureState = await this.providers.rounds.getFeatureState(playerId, gameId);
    return {
      playerId,
      gameId,
      featureState: gameId === "book-of-the-sands" ? presentationState(featureState) : featureState,
      ...(open ? { pendingRound: presentationResult(open.result), pendingActionId: open.continuation.action.id } : {}),
    };
  }
}
