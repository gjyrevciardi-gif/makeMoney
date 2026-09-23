import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

// Loaded through createRequire so bundlers (vite/vitest) do not try to resolve
// node:sqlite statically - it is a Node builtin, never a package.
const require_ = createRequire(import.meta.url);
const { DatabaseSync } = require_('node:sqlite') as {
  DatabaseSync: new (path: string) => any;
};
type DatabaseSync = any;
import {
  STARTING_BALANCE, type LedgerEvent, type LedgerType,
} from '../../../shared/types.js';

export const DEMO_PLAYER = 'demo-player';

export interface RoundRecord {
  roundId: string;
  playerId: string;
  stake: number;
  status: string;
  responseJson: string;
  createdAt: number;
}

export class Store {
  private db: DatabaseSync;

  constructor(file = 'wallet.db') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.ensurePlayer(DEMO_PLAYER);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id         TEXT PRIMARY KEY,
        balance    INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- append-only: no UPDATE or DELETE is ever issued against this table
      CREATE TABLE IF NOT EXISTS ledger (
        id            TEXT PRIMARY KEY,
        round_id      TEXT NOT NULL,
        player_id     TEXT NOT NULL REFERENCES players(id),
        type          TEXT NOT NULL CHECK (type IN ('BET','WIN','BONUS_BUY','VOID')),
        amount        INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ledger_round ON ledger(round_id);

      -- one row per settled round == the idempotency key
      CREATE TABLE IF NOT EXISTS rounds (
        round_id      TEXT PRIMARY KEY,
        player_id     TEXT NOT NULL REFERENCES players(id),
        stake         INTEGER NOT NULL,
        status        TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );

      -- exactly one ledger row per (round, type): the hard idempotency guard
      CREATE UNIQUE INDEX IF NOT EXISTS ledger_round_type
        ON ledger(round_id, type);
    `);
  }

  private ensurePlayer(id: string): void {
    const row = this.db.prepare('SELECT id FROM players WHERE id = ?').get(id);
    if (!row) {
      this.db.prepare(
        'INSERT INTO players (id, balance, created_at) VALUES (?, ?, ?)',
      ).run(id, STARTING_BALANCE, Date.now());
    }
  }

  balance(playerId = DEMO_PLAYER): number {
    const row = this.db.prepare('SELECT balance FROM players WHERE id = ?')
      .get(playerId) as { balance: number } | undefined;
    if (!row) throw new Error(`unknown player ${playerId}`);
    return Number(row.balance);
  }

  getRound(roundId: string): RoundRecord | undefined {
    const r = this.db.prepare('SELECT * FROM rounds WHERE round_id = ?')
      .get(roundId) as any;
    if (!r) return undefined;
    return {
      roundId: String(r.round_id), playerId: String(r.player_id),
      stake: Number(r.stake), status: String(r.status),
      responseJson: String(r.response_json), createdAt: Number(r.created_at),
    };
  }

  ledger(playerId = DEMO_PLAYER): LedgerEvent[] {
    const rows = this.db.prepare(
      'SELECT * FROM ledger WHERE player_id = ? ORDER BY created_at, rowid',
    ).all(playerId) as any[];
    return rows.map((r) => ({
      id: String(r.id), roundId: String(r.round_id), type: String(r.type) as LedgerType,
      amount: Number(r.amount), balanceAfter: Number(r.balance_after),
      createdAt: Number(r.created_at),
    }));
  }

  /** Sum of every ledger amount - must always equal balance - STARTING_BALANCE. */
  ledgerSum(playerId = DEMO_PLAYER): number {
    const r = this.db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS s FROM ledger WHERE player_id = ?',
    ).get(playerId) as { s: number };
    return Number(r.s);
  }

  /**
   * Settle an entire round atomically: debit, credit, persist the response.
   *
   * Idempotent by construction. The body runs inside one SQLite transaction,
   * and `rounds.round_id` is the primary key - a replay of the same roundId is
   * short-circuited to the stored response. The unique index on
   * (round_id, type) is a second, independent guard, so a duplicate BET or WIN
   * row is impossible even if the first check were bypassed.
   */
  settleRound(args: {
    roundId: string;
    playerId?: string;
    stake: number;
    cost: number;
    costType: 'BET' | 'BONUS_BUY';
    win: number;
    buildResponse: (balanceAfter: number) => unknown;
  }): { response: unknown; replayed: boolean } {
    const playerId = args.playerId ?? DEMO_PLAYER;

    const existing = this.getRound(args.roundId);
    if (existing) {
      return { response: JSON.parse(existing.responseJson), replayed: true };
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.db.prepare('SELECT balance FROM players WHERE id = ?')
        .get(playerId) as { balance: number };
      const startBal = Number(cur.balance);
      if (startBal < args.cost) {
        const e: any = new Error('INSUFFICIENT_FUNDS');
        e.code = 'INSUFFICIENT_FUNDS';
        throw e;
      }

      const now = Date.now();
      let bal = startBal;

      bal -= args.cost;
      this.db.prepare(
        `INSERT INTO ledger (id, round_id, player_id, type, amount, balance_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), args.roundId, playerId, args.costType, -args.cost, bal, now);

      if (args.win > 0) {
        bal += args.win;
        this.db.prepare(
          `INSERT INTO ledger (id, round_id, player_id, type, amount, balance_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), args.roundId, playerId, 'WIN', args.win, bal, now);
      }

      this.db.prepare('UPDATE players SET balance = ? WHERE id = ?').run(bal, playerId);

      const response = args.buildResponse(bal);
      this.db.prepare(
        `INSERT INTO rounds (round_id, player_id, stake, status, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(args.roundId, playerId, args.stake, 'SETTLED', JSON.stringify(response), now);

      this.db.exec('COMMIT');
      return { response, replayed: false };
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw e;
    }
  }

  /** Test helper - wipes everything and re-seeds the demo player. */
  reset(): void {
    this.db.exec('DELETE FROM ledger; DELETE FROM rounds; DELETE FROM players;');
    this.ensurePlayer(DEMO_PLAYER);
  }

  close(): void {
    this.db.close();
  }
}
