import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { GameConfig } from "@slot-skills/schema";
import { canonicalJson } from "@slot-skills/schema";
import type { RngProvider } from "@slot-skills/math";
import { CryptoRngProvider } from "@slot-skills/math";
import { DefaultGameEngine, jurisdictionProfiles, roundCostUnits, type GameEngine, type GameRoundResult, type InternalContinuation, type PendingAction } from "@slot-skills/runtime";
import type { HostProviders } from "./providers.js";

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
}

export interface GameHostOptions {
  games: readonly GameConfig[];
  providers: HostProviders;
  rng?: RngProvider;
  engine?: GameEngine;
  production?: boolean;
  now?: () => number;
}

export class ReferenceGameHost {
  readonly games: ReadonlyMap<string, GameConfig>;
  readonly providers: HostProviders;
  readonly rng: RngProvider;
  readonly engine: GameEngine;
  readonly production: boolean;
  readonly now: () => number;

  constructor(options: GameHostOptions) {
    this.games = new Map(options.games.map((game) => [game.id, game]));
    this.providers = options.providers;
    this.rng = options.rng ?? new CryptoRngProvider();
    this.engine = options.engine ?? new DefaultGameEngine();
    this.production = options.production ?? false;
    this.now = options.now ?? Date.now;
    if (this.production && !this.rng.production) throw new Error(`Test RNG ${this.rng.id} cannot run in production mode`);
  }

  async spin(input: SpinInput): Promise<GameRoundResult> {
    if (!input.idempotencyKey.trim()) throw new Error("An idempotency key is required");
    const idempotent = await this.providers.rounds.getIdempotent(input.idempotencyKey);
    if (idempotent) return idempotent;
    const game = this.games.get(input.gameId);
    if (!game) throw new Error(`Unknown game: ${input.gameId}`);
    const session = await this.providers.sessions.get(input.playerId);
    if (session.jurisdiction !== game.jurisdiction.profileId) throw new Error(`Session jurisdiction ${session.jurisdiction} cannot play ${game.jurisdiction.profileId}`);
    const profile = jurisdictionProfiles[game.jurisdiction.profileId as keyof typeof jurisdictionProfiles];
    if (!profile) throw new Error(`Unknown jurisdiction profile: ${game.jurisdiction.profileId}`);
    const bet = BigInt(input.betUnits);
    if (bet <= 0n || bet > profile.maxStakeUnits(session)) throw new Error(`Bet is outside the permitted range for age band ${session.ageBand}`);
    const now = this.now();
    const nextAllowed = await this.providers.rounds.nextAllowedAt(input.playerId, game.id);
    if (now < nextAllowed) throw new Error(`Next game cycle is not permitted until ${new Date(nextAllowed).toISOString()}`);
    const roundId = randomUUID();
    const featureState = await this.providers.rounds.getFeatureState(input.playerId, game.id);
    const freeGameActive = game.id === "book-of-the-sands" && Boolean(featureState.bookOfRa && featureState.bookOfRa.freeSpinsRemaining > 0);
    const costUnits = freeGameActive ? 0n : roundCostUnits(game, {
      betUnits: input.betUnits,
      ...(input.purchasedFeatureId ? { purchasedFeatureId: input.purchasedFeatureId } : {}),
      ...(input.anteBet ? { anteBet: true } : {}),
    });
    await this.providers.wallet.reserve(input.playerId, roundId, costUnits.toString());
    try {
      const computation = await this.engine.spin(game, {
        roundId, playerId: input.playerId, betUnits: input.betUnits, featureState,
        ...(input.purchasedFeatureId ? { purchasedFeatureId: input.purchasedFeatureId } : {}),
        ...(input.anteBet ? { anteBet: true } : {}),
        ...(input.autoplay ? { autoplay: true } : {}),
      }, this.rng);
      await this.providers.rounds.saveFeatureState(input.playerId, game.id, computation.result.featureState);
      await this.providers.rounds.saveRound(computation.result, computation.continuation);
      await this.providers.rounds.setNextAllowedAt(input.playerId, game.id, now + profile.minimumCycleMs);
      if (computation.result.complete) await this.providers.wallet.settle(roundId, computation.result.totalWinUnits);
      if (game.features.some((feature) => feature.enabled && feature.id === "progressive-jackpot")) {
        await this.providers.jackpot.contribute(`${game.id}:progressive`, roundId, (bet / 100n).toString());
      }
      await this.providers.audit.append({ at: new Date(now).toISOString(), type: "round-created", playerId: input.playerId, roundId, gameId: game.id, payload: { outcomeHash: computation.result.outcomeHash, mathVersion: game.version, rng: this.rng.id } });
      await this.providers.rounds.saveIdempotent(input.idempotencyKey, computation.result);
      return computation.result;
    } catch (error) {
      await this.providers.wallet.rollback(roundId);
      await this.providers.audit.append({ at: new Date(now).toISOString(), type: "round-failed", playerId: input.playerId, roundId, gameId: game.id, payload: { message: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  async resolveAction(input: ActionInput): Promise<GameRoundResult> {
    const existing = await this.providers.rounds.getIdempotent(input.idempotencyKey);
    if (existing) return existing;
    const continuation = await this.providers.rounds.getContinuation(input.roundId);
    if (!continuation) throw new Error(`No pending action for ${input.roundId}`);
    if (continuation.baseResult.playerId !== input.playerId) throw new Error("Pending action belongs to another player");
    let result = this.engine.resolveAction(continuation, input.actionId, input.choiceId);
    let nextContinuation: InternalContinuation | undefined;
    const gamble = continuation.action.featureId === "gamble-feature" && (input.choiceId === "red" || input.choiceId === "black");
    const currentAttempts = result.featureState.bookOfRa?.gambleAttempts ?? 0;
    if (gamble && BigInt(result.totalWinUnits) > 0n && currentAttempts < 5) {
      const colorDraw = await this.rng.uniformInt(2, `book-of-ra:gamble:${currentAttempts}`);
      const winningColor = colorDraw.value === 0 ? "red" : "black";
      const nextAttempt = currentAttempts + 1;
      const nextAction: PendingAction = { id: `${input.roundId}:gamble-feature:${nextAttempt}`, type: "gamble", featureId: "gamble-feature", choices: [{ id: "red", labelKey: "bonus.gamble.red" }, { id: "black", labelKey: "bonus.gamble.black" }, { id: "collect", labelKey: "bonus.gamble.collect" }] };
      result = { ...result, complete: false, pendingAction: nextAction, roundState: "GAMBLE_PENDING", featureState: { ...result.featureState, bookOfRa: { ...(result.featureState.bookOfRa ?? { phase: "GAMBLE_PENDING", betPerLine: result.betUnits, totalBet: (BigInt(result.betUnits) * 10n).toString(), activeLines: 10, freeSpinsRemaining: 0, freeSpinsPlayed: 0 }), phase: "GAMBLE_PENDING", gambleAttempts: nextAttempt } } };
      const { outcomeHash: _oldHash, ...withoutHash } = result;
      result = { ...result, outcomeHash: createHash("sha256").update(canonicalJson(withoutHash)).digest("hex") };
      nextContinuation = { action: nextAction, awardsByChoice: { red: winningColor === "red" ? result.totalWinUnits : (-BigInt(result.totalWinUnits)).toString(), black: winningColor === "black" ? result.totalWinUnits : (-BigInt(result.totalWinUnits)).toString(), collect: "0" }, baseResult: result };
    }
    if (result.complete) await this.providers.wallet.settle(input.roundId, result.totalWinUnits);
    await this.providers.rounds.saveRound(result, nextContinuation);
    await this.providers.rounds.saveIdempotent(input.idempotencyKey, result);
    await this.providers.audit.append({ at: new Date(this.now()).toISOString(), type: "round-action-resolved", playerId: input.playerId, roundId: input.roundId, gameId: result.gameId, payload: { actionId: input.actionId, choiceId: input.choiceId, outcomeHash: result.outcomeHash } });
    return result;
  }

  async round(roundId: string): Promise<GameRoundResult> {
    const result = await this.providers.rounds.getRound(roundId);
    if (!result) throw new Error(`Unknown round: ${roundId}`);
    return result;
  }

  async currentState(playerId: string, gameId: string): Promise<{ playerId: string; gameId: string; featureState: Awaited<ReturnType<HostProviders["rounds"]["getFeatureState"]>>; pendingRound?: GameRoundResult }> {
    if (!this.games.has(gameId)) throw new Error(`Unknown game: ${gameId}`);
    const open = await this.providers.rounds.getOpenRound(playerId, gameId);
    return { playerId, gameId, featureState: await this.providers.rounds.getFeatureState(playerId, gameId), ...(open ? { pendingRound: open.result } : {}) };
  }
}
