import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "@slot-skills/schema";
import type { FeatureState } from "@slot-skills/features";
import type { GameRoundResult, InternalContinuation } from "@slot-skills/runtime";
import type {
  AtomicRoundCommit,
  AtomicRoundProvider,
  AuditRecord,
  AuditStore,
  IdempotencyRecord,
  IdempotencyScope,
  JackpotProvider,
  PlayerSession,
  RoundStore,
  SessionProvider,
  WalletProvider,
} from "./providers.js";

/**
 * Reference persistence for the developer harness.
 *
 * This store is NOT the production wallet: the platform keeps its own
 * PostgreSQL wallet and append-only ledger, and the Book of Ra adapter writes
 * through those. What this store does model faithfully is the *shape* of the
 * guarantees the platform relies on: scoped idempotency, one transaction per
 * round, and a deterministic replay of an already-committed request.
 */
export class ReferenceSqliteStore implements WalletProvider, JackpotProvider, SessionProvider, AuditStore, RoundStore, AtomicRoundProvider {
  readonly id = "reference-sqlite-non-production";
  readonly supportsAtomicRounds = true as const;
  readonly db: DatabaseSync;

  constructor(filename = ":memory:") {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS wallets (player_id TEXT PRIMARY KEY, balance_units TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (round_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, amount_units TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (player_id TEXT PRIMARY KEY, age_band TEXT NOT NULL, jurisdiction TEXT NOT NULL, locale TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jackpots (jackpot_id TEXT PRIMARY KEY, balance_units TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jackpot_transactions (round_id TEXT NOT NULL, jackpot_id TEXT NOT NULL, kind TEXT NOT NULL, amount_units TEXT NOT NULL, PRIMARY KEY (round_id, jackpot_id, kind));
      CREATE TABLE IF NOT EXISTS rounds (round_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, continuation_json TEXT);
      CREATE TABLE IF NOT EXISTS idempotency (
        player_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        round_id TEXT NOT NULL,
        result_json TEXT NOT NULL,
        PRIMARY KEY (player_id, game_id, operation, request_key)
      );
      CREATE TABLE IF NOT EXISTS feature_state (player_id TEXT NOT NULL, game_id TEXT NOT NULL, state_json TEXT NOT NULL, PRIMARY KEY (player_id, game_id));
      CREATE TABLE IF NOT EXISTS open_round (player_id TEXT NOT NULL, game_id TEXT NOT NULL, round_id TEXT NOT NULL, PRIMARY KEY (player_id, game_id));
      CREATE TABLE IF NOT EXISTS cycle_limits (player_id TEXT NOT NULL, game_id TEXT NOT NULL, next_allowed_at INTEGER NOT NULL, PRIMARY KEY (player_id, game_id));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, player_id TEXT, round_id TEXT, game_id TEXT, payload_json TEXT NOT NULL);
    `);
    this.#upgrade();
  }

  /** Upgrade in place, preserving legacy responses and unresolved rounds. */
  #upgrade(): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const columns = this.db.prepare("PRAGMA table_info(idempotency)").all();
      if (!columns.some(column => column.name === "fingerprint")) {
        this.db.exec(`
          ALTER TABLE idempotency RENAME TO idempotency_legacy;
          CREATE TABLE idempotency (
            player_id TEXT NOT NULL, game_id TEXT NOT NULL, operation TEXT NOT NULL,
            request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, round_id TEXT NOT NULL,
            result_json TEXT NOT NULL, PRIMARY KEY(player_id, game_id, operation, request_key)
          );
        `);
        const insert = this.db.prepare("INSERT INTO idempotency VALUES (?, ?, 'legacy', ?, 'legacy-unbound', ?, ?)");
        for (const row of this.db.prepare("SELECT request_key, result_json FROM idempotency_legacy").all()) {
          const result = JSON.parse(String(row.result_json)) as GameRoundResult;
          if (!result.playerId || !result.gameId || !result.roundId) throw new Error("Invalid legacy idempotency response");
          // Old bodies were not stored. Reserve the key and reject ambiguous
          // replays instead of guessing a fingerprint and risking another debit.
          insert.run(result.playerId, result.gameId, row.request_key!, result.roundId, row.result_json!);
        }
      }
      for (const row of this.db.prepare("SELECT result_json, continuation_json FROM rounds WHERE continuation_json IS NOT NULL").all()) {
        const result = JSON.parse(String(row.result_json)) as GameRoundResult;
        if (result.complete) continue;
        const previous = this.db.prepare("SELECT round_id FROM open_round WHERE player_id = ? AND game_id = ?").get(result.playerId, result.gameId);
        if (previous && previous.round_id !== result.roundId) throw new Error("Multiple legacy pending rounds require recovery");
        this.#rememberOpenRound(result, JSON.parse(String(row.continuation_json)) as InternalContinuation);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  close(): void { this.db.close(); }

  initializePlayer(session: PlayerSession, balanceUnits = "100000"): void {
    this.db.prepare("INSERT OR REPLACE INTO sessions(player_id, age_band, jurisdiction, locale) VALUES (?, ?, ?, ?)").run(session.playerId, session.ageBand, session.jurisdiction, session.locale);
    this.db.prepare("INSERT OR IGNORE INTO wallets(player_id, balance_units) VALUES (?, ?)").run(session.playerId, balanceUnits);
  }

  initializeJackpot(jackpotId: string, balanceUnits = "0"): void {
    this.db.prepare("INSERT OR IGNORE INTO jackpots(jackpot_id, balance_units) VALUES (?, ?)").run(jackpotId, balanceUnits);
  }

  async get(playerId: string): Promise<PlayerSession> {
    const row = this.db.prepare("SELECT player_id, age_band, jurisdiction, locale FROM sessions WHERE player_id = ?").get(playerId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Unknown reference session: ${playerId}`);
    return { playerId: String(row.player_id), ageBand: String(row.age_band) as PlayerSession["ageBand"], jurisdiction: String(row.jurisdiction), locale: String(row.locale) };
  }

  /** Debit within an already-open transaction. Never opens its own. */
  #reserveWithin(playerId: string, roundId: string, amountUnits: string): void {
    const amount = BigInt(amountUnits);
    // Zero is a legitimate reservation: a free spin has to be recorded so it
    // settles exactly once, but it must not move any balance.
    if (amount < 0n) throw new Error("Reservation amount cannot be negative");
    const existing = this.db.prepare("SELECT player_id, amount_units, status FROM reservations WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.player_id !== playerId || existing.amount_units !== amountUnits) throw new Error("Round reservation conflicts with the original request");
      if (existing.status !== "reserved") throw new Error(`Reservation ${roundId} is ${String(existing.status)}`);
      return;
    }
    const row = this.db.prepare("SELECT balance_units FROM wallets WHERE player_id = ?").get(playerId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Wallet not found for ${playerId}`);
    const balance = BigInt(String(row.balance_units));
    if (balance < amount) throw new Error("Insufficient balance");
    if (amount > 0n) this.db.prepare("UPDATE wallets SET balance_units = ? WHERE player_id = ?").run((balance - amount).toString(), playerId);
    this.db.prepare("INSERT INTO reservations(round_id, player_id, amount_units, status) VALUES (?, ?, ?, 'reserved')").run(roundId, playerId, amountUnits);
  }

  async reserve(playerId: string, roundId: string, amountUnits: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.#reserveWithin(playerId, roundId, amountUnits);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** Credit within an already-open transaction. Never opens its own. */
  #settleWithin(roundId: string, awardUnits: string): void {
    const award = BigInt(awardUnits);
    if (award < 0n) throw new Error("A settlement cannot be negative");
    const row = this.db.prepare("SELECT player_id, status FROM reservations WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Reservation not found for ${roundId}`);
    if (row.status === "settled") return;
    if (row.status !== "reserved") throw new Error(`Reservation ${roundId} is ${String(row.status)}`);
    const playerId = String(row.player_id);
    if (award > 0n) {
      const wallet = this.db.prepare("SELECT balance_units FROM wallets WHERE player_id = ?").get(playerId) as Record<string, unknown>;
      this.db.prepare("UPDATE wallets SET balance_units = ? WHERE player_id = ?").run((BigInt(String(wallet.balance_units)) + award).toString(), playerId);
    }
    this.db.prepare("UPDATE reservations SET status = 'settled' WHERE round_id = ?").run(roundId);
  }

  async settle(roundId: string, awardUnits: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.#settleWithin(roundId, awardUnits);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  async rollback(roundId: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT player_id, amount_units, status FROM reservations WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
      if (!row || row.status === "rolled-back") { this.db.exec("COMMIT"); return; }
      if (row.status !== "reserved") throw new Error(`Cannot roll back ${row.status} reservation`);
      const playerId = String(row.player_id);
      const wallet = this.db.prepare("SELECT balance_units FROM wallets WHERE player_id = ?").get(playerId) as Record<string, unknown>;
      this.db.prepare("UPDATE wallets SET balance_units = ? WHERE player_id = ?").run((BigInt(String(wallet.balance_units)) + BigInt(String(row.amount_units))).toString(), playerId);
      this.db.prepare("UPDATE reservations SET status = 'rolled-back' WHERE round_id = ?").run(roundId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  async balance(identifier: string): Promise<string> {
    const wallet = this.db.prepare("SELECT balance_units FROM wallets WHERE player_id = ?").get(identifier) as Record<string, unknown> | undefined;
    if (wallet) return String(wallet.balance_units);
    const jackpot = this.db.prepare("SELECT balance_units FROM jackpots WHERE jackpot_id = ?").get(identifier) as Record<string, unknown> | undefined;
    if (jackpot) return String(jackpot.balance_units);
    throw new Error(`Balance not found: ${identifier}`);
  }

  async contribute(jackpotId: string, roundId: string, amountUnits: string): Promise<string> {
    this.initializeJackpot(jackpotId);
    const existing = this.db.prepare("SELECT amount_units FROM jackpot_transactions WHERE round_id = ? AND jackpot_id = ? AND kind = 'contribution'").get(roundId, jackpotId) as Record<string, unknown> | undefined;
    if (existing) return this.balance(jackpotId);
    const balance = BigInt(await this.balance(jackpotId)) + BigInt(amountUnits);
    this.db.prepare("UPDATE jackpots SET balance_units = ? WHERE jackpot_id = ?").run(balance.toString(), jackpotId);
    this.db.prepare("INSERT INTO jackpot_transactions(round_id, jackpot_id, kind, amount_units) VALUES (?, ?, 'contribution', ?)").run(roundId, jackpotId, amountUnits);
    return balance.toString();
  }

  async award(jackpotId: string, roundId: string, _playerId: string): Promise<string> {
    const existing = this.db.prepare("SELECT amount_units FROM jackpot_transactions WHERE round_id = ? AND jackpot_id = ? AND kind = 'award'").get(roundId, jackpotId) as Record<string, unknown> | undefined;
    if (existing) return String(existing.amount_units);
    const amount = await this.balance(jackpotId);
    this.db.prepare("UPDATE jackpots SET balance_units = '0' WHERE jackpot_id = ?").run(jackpotId);
    this.db.prepare("INSERT INTO jackpot_transactions(round_id, jackpot_id, kind, amount_units) VALUES (?, ?, 'award', ?)").run(roundId, jackpotId, amount);
    return amount;
  }

  async append(record: AuditRecord): Promise<void> {
    this.db.prepare("INSERT INTO audit(at, type, player_id, round_id, game_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.at, record.type, record.playerId ?? null, record.roundId ?? null, record.gameId ?? null, JSON.stringify(record.payload));
  }

  async getIdempotent(scope: IdempotencyScope): Promise<IdempotencyRecord | undefined> {
    return this.#idempotent(scope);
  }

  #idempotent(scope: IdempotencyScope): IdempotencyRecord | undefined {
    const row = this.db
      .prepare("SELECT result_json, fingerprint FROM idempotency WHERE player_id = ? AND game_id = ? AND operation IN (?, 'legacy') AND request_key = ? ORDER BY operation = 'legacy' LIMIT 1")
      .get(scope.playerId, scope.gameId, scope.operation, scope.requestKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return { result: JSON.parse(String(row.result_json)) as GameRoundResult, fingerprint: String(row.fingerprint) };
  }

  async saveIdempotent(scope: IdempotencyScope, result: GameRoundResult, fingerprint = ""): Promise<void> {
    this.db
      .prepare("INSERT OR REPLACE INTO idempotency(player_id, game_id, operation, request_key, fingerprint, round_id, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(scope.playerId, scope.gameId, scope.operation, scope.requestKey, fingerprint, result.roundId, JSON.stringify(result));
  }

  /**
   * One round, one transaction: debit, credit, round, continuation, feature
   * state, idempotency record and audit row all commit together or not at all.
   *
   * A round that still has a pending action reserves its stake but is not
   * settled; the settlement happens when the action resolves the round, which
   * is why `complete` decides whether the credit is applied here.
   */
  async commitRound(commit: AtomicRoundCommit): Promise<GameRoundResult> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const replay = this.#idempotent(commit.idempotency);
      if (replay) {
        if (replay.fingerprint !== commit.idempotency.fingerprint) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        this.db.exec("COMMIT");
        return replay.result;
      }
      const stored = this.db.prepare("SELECT state_json FROM feature_state WHERE player_id = ? AND game_id = ?").get(commit.playerId, commit.gameId);
      const state = stored ? JSON.parse(String(stored.state_json)) : {};
      if (canonicalJson(state) !== canonicalJson(commit.expectedState)) throw new Error("STATE_CONFLICT: refresh before retrying this request");
      if (commit.costUnits !== undefined) this.#reserveWithin(commit.playerId, commit.roundId, commit.costUnits);
      this.db.prepare("INSERT OR REPLACE INTO rounds(round_id, result_json, continuation_json) VALUES (?, ?, ?)")
        .run(commit.roundId, JSON.stringify(commit.result), commit.continuation ? JSON.stringify(commit.continuation) : null);
      this.#rememberOpenRound(commit.result, commit.continuation);
      this.db.prepare("INSERT OR REPLACE INTO feature_state(player_id, game_id, state_json) VALUES (?, ?, ?)")
        .run(commit.playerId, commit.gameId, JSON.stringify(commit.state));
      this.db
        .prepare("INSERT OR REPLACE INTO idempotency(player_id, game_id, operation, request_key, fingerprint, round_id, result_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          commit.idempotency.playerId,
          commit.idempotency.gameId,
          commit.idempotency.operation,
          commit.idempotency.requestKey,
          commit.idempotency.fingerprint,
          commit.roundId,
          JSON.stringify(commit.result),
        );
      if (commit.audit) {
        this.db.prepare("INSERT INTO audit(at, type, player_id, round_id, game_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)")
          .run(commit.audit.at, commit.audit.type, commit.audit.playerId ?? null, commit.audit.roundId ?? null, commit.audit.gameId ?? null, JSON.stringify(commit.audit.payload));
      }
      if (commit.result.complete) this.#settleWithin(commit.roundId, commit.awardUnits);
      this.db.exec("COMMIT");
      return commit.result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async saveRound(result: GameRoundResult, continuation?: InternalContinuation): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO rounds(round_id, result_json, continuation_json) VALUES (?, ?, ?)")
      .run(result.roundId, JSON.stringify(result), continuation ? JSON.stringify(continuation) : null);
    this.#rememberOpenRound(result, continuation);
  }

  /** An open round is the one with an unresolved pending action, if any. */
  #rememberOpenRound(result: GameRoundResult, continuation?: InternalContinuation): void {
    if (continuation && !result.complete) {
      this.db
        .prepare("INSERT OR REPLACE INTO open_round(player_id, game_id, round_id) VALUES (?, ?, ?)")
        .run(result.playerId, result.gameId, result.roundId);
      return;
    }
    this.db
      .prepare("DELETE FROM open_round WHERE player_id = ? AND game_id = ? AND round_id = ?")
      .run(result.playerId, result.gameId, result.roundId);
  }

  async getRound(roundId: string): Promise<GameRoundResult | undefined> {
    const row = this.db.prepare("SELECT result_json FROM rounds WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
    return row ? JSON.parse(String(row.result_json)) as GameRoundResult : undefined;
  }

  async getOpenRound(playerId: string, gameId: string): Promise<{ result: GameRoundResult; continuation: InternalContinuation } | undefined> {
    const pointer = this.db
      .prepare("SELECT round_id FROM open_round WHERE player_id = ? AND game_id = ?")
      .get(playerId, gameId) as Record<string, unknown> | undefined;
    if (!pointer) return undefined;
    const row = this.db
      .prepare("SELECT result_json, continuation_json FROM rounds WHERE round_id = ?")
      .get(String(pointer.round_id)) as Record<string, unknown> | undefined;
    if (!row?.continuation_json) return undefined;
    return {
      result: JSON.parse(String(row.result_json)) as GameRoundResult,
      continuation: JSON.parse(String(row.continuation_json)) as InternalContinuation,
    };
  }

  async getContinuation(roundId: string): Promise<InternalContinuation | undefined> {
    const row = this.db.prepare("SELECT continuation_json FROM rounds WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
    return row?.continuation_json ? JSON.parse(String(row.continuation_json)) as InternalContinuation : undefined;
  }

  async saveFeatureState(playerId: string, gameId: string, state: FeatureState): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO feature_state(player_id, game_id, state_json) VALUES (?, ?, ?)").run(playerId, gameId, JSON.stringify(state));
  }

  async getFeatureState(playerId: string, gameId: string): Promise<FeatureState> {
    const row = this.db.prepare("SELECT state_json FROM feature_state WHERE player_id = ? AND game_id = ?").get(playerId, gameId) as Record<string, unknown> | undefined;
    return row ? JSON.parse(String(row.state_json)) as FeatureState : {};
  }

  async nextAllowedAt(playerId: string, gameId: string): Promise<number> {
    const row = this.db.prepare("SELECT next_allowed_at FROM cycle_limits WHERE player_id = ? AND game_id = ?").get(playerId, gameId) as Record<string, unknown> | undefined;
    return row ? Number(row.next_allowed_at) : 0;
  }

  async setNextAllowedAt(playerId: string, gameId: string, timestamp: number): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO cycle_limits(player_id, game_id, next_allowed_at) VALUES (?, ?, ?)").run(playerId, gameId, timestamp);
  }
}
