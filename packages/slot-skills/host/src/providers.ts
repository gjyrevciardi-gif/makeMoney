import type { InternalContinuation, GameRoundResult } from "@slot-skills/runtime";
import type { FeatureState } from "@slot-skills/features";

export interface PlayerSession {
  playerId: string;
  ageBand: "18-24" | "25+";
  jurisdiction: string;
  locale: string;
}

export interface WalletProvider {
  readonly id: string;
  reserve(playerId: string, roundId: string, amountUnits: string): Promise<void>;
  settle(roundId: string, awardUnits: string): Promise<void>;
  rollback(roundId: string): Promise<void>;
  balance(playerId: string): Promise<string>;
}

export interface JackpotProvider {
  readonly id: string;
  contribute(jackpotId: string, roundId: string, amountUnits: string): Promise<string>;
  award(jackpotId: string, roundId: string, playerId: string): Promise<string>;
  balance(jackpotId: string): Promise<string>;
}

export interface SessionProvider {
  readonly id: string;
  get(playerId: string): Promise<PlayerSession>;
}

export interface AuditRecord {
  at: string;
  type: string;
  playerId?: string;
  roundId?: string;
  gameId?: string;
  payload: Record<string, unknown>;
}

export interface AuditStore {
  readonly id: string;
  append(record: AuditRecord): Promise<void>;
}

export interface RoundStore {
  getIdempotent(key: string): Promise<GameRoundResult | undefined>;
  saveIdempotent(key: string, result: GameRoundResult): Promise<void>;
  saveRound(result: GameRoundResult, continuation?: InternalContinuation): Promise<void>;
  getRound(roundId: string): Promise<GameRoundResult | undefined>;
  getOpenRound(playerId: string, gameId: string): Promise<{ result: GameRoundResult; continuation: InternalContinuation } | undefined>;
  getContinuation(roundId: string): Promise<InternalContinuation | undefined>;
  saveFeatureState(playerId: string, gameId: string, state: FeatureState): Promise<void>;
  getFeatureState(playerId: string, gameId: string): Promise<FeatureState>;
  nextAllowedAt(playerId: string, gameId: string): Promise<number>;
  setNextAllowedAt(playerId: string, gameId: string, timestamp: number): Promise<void>;
}

export interface HostProviders {
  wallet: WalletProvider;
  jackpot: JackpotProvider;
  sessions: SessionProvider;
  audit: AuditStore;
  rounds: RoundStore;
}
