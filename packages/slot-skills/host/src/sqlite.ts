import { DatabaseSync } from "node:sqlite";
import type { FeatureState } from "@slot-skills/features";
import type { GameRoundResult, InternalContinuation } from "@slot-skills/runtime";
import type { AuditRecord, AuditStore, JackpotProvider, PlayerSession, RoundStore, SessionProvider, WalletProvider } from "./providers.js";

export class ReferenceSqliteStore implements WalletProvider, JackpotProvider, SessionProvider, AuditStore, RoundStore {
  readonly id = "reference-sqlite-non-production";
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
      CREATE TABLE IF NOT EXISTS idempotency (request_key TEXT PRIMARY KEY, result_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS feature_state (player_id TEXT NOT NULL, game_id TEXT NOT NULL, state_json TEXT NOT NULL, PRIMARY KEY (player_id, game_id));
      CREATE TABLE IF NOT EXISTS cycle_limits (player_id TEXT NOT NULL, game_id TEXT NOT NULL, next_allowed_at INTEGER NOT NULL, PRIMARY KEY (player_id, game_id));
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, player_id TEXT, round_id TEXT, game_id TEXT, payload_json TEXT NOT NULL);
    `);
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

  async reserve(playerId: string, roundId: string, amountUnits: string): Promise<void> {
    const amount = BigInt(amountUnits);
    if (amount <= 0n) throw new Error("Reservation amount must be positive");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT player_id, amount_units FROM reservations WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
      if (existing) {
        if (existing.player_id !== playerId || existing.amount_units !== amountUnits) throw new Error("Round reservation conflicts with the original request");
        this.db.exec("COMMIT");
        return;
      }
      const row = this.db.prepare("SELECT balance_units FROM wallets WHERE player_id = ?").get(playerId) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Wallet not found for ${playerId}`);
      const balance = BigInt(String(row.balance_units));
      if (balance < amount) throw new Error("Insufficient balance");
      this.db.prepare("UPDATE wallets SET balance_units = ? WHERE player_id = ?").run((balance - amount).toString(), playerId);
      this.db.prepare("INSERT INTO reservations(round_id, player_id, amount_units, status) VALUES (?, ?, ?, 'reserved')").run(roundId, playerId, amountUnits);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async settle(roundId: string, awardUnits: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT player_id, status FROM reservations WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Reservation not found for ${roundId}`);
      if (row.status === "settled") { this.db.exec("COMMIT"); return; }
      if (row.status !== "reserved") throw new Error(`Reservation ${roundId} is ${row.status}`);
      const playerId = String(row.player_id);
      const wallet = this.db.prepare("SELECT balance_units FROM wallets WHERE player_id = ?").get(playerId) as Record<string, unknown>;
      this.db.prepare("UPDATE wallets SET balance_units = ? WHERE player_id = ?").run((BigInt(String(wallet.balance_units)) + BigInt(awardUnits)).toString(), playerId);
      this.db.prepare("UPDATE reservations SET status = 'settled' WHERE round_id = ?").run(roundId);
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

  async getIdempotent(key: string): Promise<GameRoundResult | undefined> {
    const row = this.db.prepare("SELECT result_json FROM idempotency WHERE request_key = ?").get(key) as Record<string, unknown> | undefined;
    return row ? JSON.parse(String(row.result_json)) as GameRoundResult : undefined;
  }

  async saveIdempotent(key: string, result: GameRoundResult): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO idempotency(request_key, result_json) VALUES (?, ?)").run(key, JSON.stringify(result));
  }

  async saveRound(result: GameRoundResult, continuation?: InternalContinuation): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO rounds(round_id, result_json, continuation_json) VALUES (?, ?, ?)")
      .run(result.roundId, JSON.stringify(result), continuation ? JSON.stringify(continuation) : null);
  }

  async getRound(roundId: string): Promise<GameRoundResult | undefined> {
    const row = this.db.prepare("SELECT result_json FROM rounds WHERE round_id = ?").get(roundId) as Record<string, unknown> | undefined;
    return row ? JSON.parse(String(row.result_json)) as GameRoundResult : undefined;
  }

  async getOpenRound(playerId: string, gameId: string): Promise<{ result: GameRoundResult; continuation: InternalContinuation } | undefined> {
    const rows = this.db.prepare("SELECT result_json, continuation_json FROM rounds WHERE continuation_json IS NOT NULL ORDER BY rowid DESC").all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const result = JSON.parse(String(row.result_json)) as GameRoundResult;
      if (result.playerId === playerId && result.gameId === gameId && row.continuation_json) return { result, continuation: JSON.parse(String(row.continuation_json)) as InternalContinuation };
    }
    return undefined;
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
