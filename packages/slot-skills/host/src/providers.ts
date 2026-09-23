import type { InternalContinuation, GameRoundResult } from "@slot-skills/runtime";
import type { FeatureState } from "@slot-skills/features";

export interface PlayerSession {
  playerId: string;
  ageBand: "18-24" | "25+";
  jurisdiction: string;
  locale: string;
}

/**
 * Value movement contract.
 *
 * `reserve` accepts a zero amount on purpose: a free spin in Book of Ra moves
 * no virtual points, but it still has to be recorded so the round settles and
 * rolls back exactly once, and so a replay cannot re-enter the sequence.
 */
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
  getIdempotent(scope: IdempotencyScope): Promise<IdempotencyRecord | undefined>;
  saveIdempotent(scope: IdempotencyScope, result: GameRoundResult, fingerprint?: string): Promise<void>;
  saveRound(result: GameRoundResult, continuation?: InternalContinuation): Promise<void>;
  getRound(roundId: string): Promise<GameRoundResult | undefined>;
  getOpenRound(playerId: string, gameId: string): Promise<{ result: GameRoundResult; continuation: InternalContinuation } | undefined>;
  getContinuation(roundId: string): Promise<InternalContinuation | undefined>;
  saveFeatureState(playerId: string, gameId: string, state: FeatureState): Promise<void>;
  getFeatureState(playerId: string, gameId: string): Promise<FeatureState>;
  nextAllowedAt(playerId: string, gameId: string): Promise<number>;
  setNextAllowedAt(playerId: string, gameId: string, timestamp: number): Promise<void>;
}

/**
 * Idempotency is scoped to the acting player, the game, and the operation, and
 * is bound to a fingerprint of the request body.
 *
 * The scope stops one player's key from ever resolving another player's round;
 * the fingerprint stops a replayed key with different parameters from being
 * silently answered with an unrelated result.
 */
export interface IdempotencyScope {
  playerId: string;
  gameId: string;
  operation: string;
  requestKey: string;
}

export interface IdempotencyRecord {
  result: GameRoundResult;
  fingerprint: string;
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT";
  constructor(message = "This request identifier was already used with different parameters") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

/**
 * One round, written in one transaction.
 *
 * Debit, credit, round, continuation, feature state and the idempotency record
 * either all become visible or none of them do. That is what makes a retry, a
 * crash between the engine call and the response, and two concurrent requests
 * safe: there is no window in which a wallet moved but its round did not exist.
 */
export interface AtomicRoundCommit {
  playerId: string;
  gameId: string;
  roundId: string;
  /**
   * Stake to reserve in this commit. Omit it when the round already holds a
   * reservation, as a later action resolving a pending decision does.
   */
  costUnits?: string | undefined;
  awardUnits: string;
  state: FeatureState;
  /** State read before computation; checked inside the committing transaction. */
  expectedState: FeatureState;
  result: GameRoundResult;
  continuation?: InternalContinuation;
  idempotency: IdempotencyScope & { fingerprint: string };
  audit?: AuditRecord;
}

export interface AtomicRoundProvider {
  readonly id: string;
  readonly supportsAtomicRounds: true;
  commitRound(commit: AtomicRoundCommit): Promise<GameRoundResult>;
}

export function isAtomicRoundProvider(value: unknown): value is AtomicRoundProvider {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AtomicRoundProvider>;
  return candidate.supportsAtomicRounds === true && typeof candidate.commitRound === "function";
}

export interface HostProviders {
  wallet: WalletProvider;
  jackpot: JackpotProvider;
  sessions: SessionProvider;
  audit: AuditStore;
  rounds: RoundStore;
  /** Optional single-transaction writer. Preferred whenever it is available. */
  atomic?: AtomicRoundProvider;
}
