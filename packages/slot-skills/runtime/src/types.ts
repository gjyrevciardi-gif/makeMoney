import type { GameConfig } from "@slot-skills/schema";
import type { Grid, RngDraw, RngProvider, Win } from "@slot-skills/math";
import type { FeatureState } from "@slot-skills/features";

export type GameEventType =
  | "round-start" | "grid-reveal" | "symbol-transform" | "reel-transform" | "colossal-transform"
  | "win" | "win-multiplier" | "symbols-remove" | "symbols-drop" | "cascade-start"
  | "free-spins-start" | "free-spin" | "free-spins-end" | "respin" | "hold-win-start" | "hold-win-end"
  | "collection-update" | "jackpot-contribution" | "jackpot-award" | "feature-start" | "feature-end"
  | "grid-resize" | "nudge" | "prize-award" | "near-miss"
  | "symbol-value" | "tumble-multiplier" | "max-win"
  | "choice-required" | "choice-resolved" | "round-complete";

export interface GameEvent {
  sequence: number;
  type: GameEventType;
  data: Record<string, unknown>;
}

export interface GameRoundRequest {
  roundId: string;
  playerId: string;
  betUnits: string;
  featureState?: FeatureState;
  purchasedFeatureId?: string;
  anteBet?: boolean;
  autoplay?: boolean;
}

export interface PendingAction {
  id: string;
  type: "pick" | "wheel" | "path" | "board" | "skill" | "gamble";
  featureId: string;
  choices: Array<{ id: string; labelKey: string }>;
}

export interface InternalContinuation {
  action: PendingAction;
  awardsByChoice: Record<string, string>;
  eventsByChoice?: Record<string, Array<{ type: GameEventType; data: Record<string, unknown> }>>;
  baseResult: GameRoundResult;
  /**
   * Pending-action state that is resolved by a dedicated round engine rather
   * than by the generic `awardsByChoice` table. Book of Ra's gamble ladder is
   * resolved from the colours drawn when the ladder was offered, so it carries
   * the authoritative round state instead of a single pre-computed award.
   */
  engine?: "generic" | "book-of-ra";
  bookOfRaState?: unknown;
}

export interface GameRoundResult {
  roundId: string;
  gameId: string;
  gameVersion: string;
  playerId: string;
  betUnits: string;
  totalWinUnits: string;
  netUnits: string;
  finalGrid: Grid;
  wins: Win[];
  events: GameEvent[];
  draws: RngDraw[];
  featureState: FeatureState;
  pendingAction?: PendingAction;
  complete: boolean;
  outcomeHash: string;
  roundState?: "IDLE" | "SPIN_PENDING" | "SPIN_RESOLVED" | "WIN_PRESENTATION" | "FREE_GAME_INTRO" | "FREE_GAME_ACTIVE" | "FREE_GAME_COMPLETE" | "GAMBLE_PENDING" | "ROUND_COMPLETE";
  regularWins?: Win[];
  scatterWin?: string;
  specialSymbol?: string;
  expandingReels?: number[];
  expandingWin?: string;
  totalSpinWin?: string;
  /** The reveal grid before any reel transformation. */
  board?: Grid;
}

export interface RoundComputation {
  result: GameRoundResult;
  continuation?: InternalContinuation;
}

export interface GameEngine {
  spin(game: GameConfig, request: GameRoundRequest, rng: RngProvider): Promise<RoundComputation>;
  resolveAction(continuation: InternalContinuation, actionId: string, choiceId: string): GameRoundResult;
  /**
   * Optional step form of `resolveAction` that also returns the continuation a
   * multi-step action leaves behind (Book of Ra's gamble ladder). Engines that
   * only ever resolve an action in one step may omit it.
   */
  resolveActionStep?(continuation: InternalContinuation, actionId: string, choiceId: string): { result: GameRoundResult; continuation?: InternalContinuation };
}
