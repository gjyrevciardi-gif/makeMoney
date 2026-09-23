/**
 * Server calls. This is the ONLY place the client talks to anything.
 *
 * Every request goes to our own origin under /api (Vite proxies it to the
 * local backend). There are no third-party hosts, analytics, CDNs or provider
 * endpoints anywhere in this client.
 */
import type { RoundResponse } from '../../shared/types';

const BASE = '/api';

export interface GameConfig {
  stakeLevels: number[];
  buyBonusMultiplier: number;
  testMode: boolean;
  vectors: string[];
}

export interface SessionInfo {
  playerId: string;
  balance: number;
  currency: string;
  stakeLevels: number[];
  buyBonusMultiplier: number;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body as any)?.error ?? `HTTP ${res.status}`);
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }
  return body as T;
}

export const api = {
  async session(): Promise<SessionInfo> {
    return json<SessionInfo>(await fetch(`${BASE}/session`));
  },

  async config(): Promise<GameConfig> {
    return json<GameConfig>(await fetch(`${BASE}/config`));
  },

  async balance(): Promise<number> {
    const b = await json<{ balance: number }>(await fetch(`${BASE}/balance`));
    return b.balance;
  },

  async spin(opts: {
    stake: number; roundId: string; buyBonus?: boolean; testVector?: string;
  }): Promise<RoundResponse> {
    return json<RoundResponse>(await fetch(`${BASE}/spin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    }));
  },

  async buyBonus(opts: { stake: number; roundId: string; testVector?: string }): Promise<RoundResponse> {
    return this.spin({ ...opts, buyBonus: true });
  },

  async round(roundId: string): Promise<RoundResponse | null> {
    const res = await fetch(`${BASE}/round/${encodeURIComponent(roundId)}`);
    if (res.status === 404) return null;
    return json<RoundResponse>(res);
  },

  async ledger(): Promise<{ sum: number; balance: number; reconciled: boolean }> {
    return json(await fetch(`${BASE}/ledger`));
  },
};

/** roundId doubles as the idempotency key. */
export function newRoundId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `r-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
