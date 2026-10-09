import { apiFetch } from './api';

export type RoundStatus = 'OPEN' | 'WON' | 'LOST' | 'CASHED_OUT' | 'CANCELLED';

export type CasinoRoundView = {
  roundId: string;
  gameType: string;
  gameVersion: string;
  status: RoundStatus;
  stake: string;
  multiplier: string | null;
  payout: string;
  createdAt: string;
  settledAt: string | null;
  state: Record<string, unknown>;
  fairness: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    serverSeed?: string;
    revealedState?: Record<string, unknown>;
  };
};

export type MinesRoundView = CasinoRoundView & {
  progress: {
    revealedCount: number;
    maxSafeCells: number;
    currentMultiplier: string | null;
    potentialPayout: string;
    nextMultiplier: string | null;
    nextPayout: string | null;
    canCashout: boolean;
  };
};

export type CasinoCategory = 'ORIGINALS' | 'TABLE_GAMES' | 'SLOTS';

export type CasinoGame = {
  id: string;
  gameType: string;
  slug: string;
  name: string;
  category: CasinoCategory;
  description: string;
  route: string;
  /** Registry switch AND the operator's persisted enable, merged by the backend. */
  enabled: boolean;
  /** Per-game maintenance, or global casino maintenance. */
  maintenance?: boolean;
  featured: boolean;
  keywords: string[];
  minStake: string;
  maxStake: string;
  supportsFairness: boolean;
  gameVersion: string;
  thumbnailKey: string;
  stateful: boolean;
  lastPlayedAt?: string;
};

export type CasinoGamesResponse = {
  games: CasinoGame[];
  platform?: { casinoMaintenance: boolean };
  limits?: { minStake: string; maxStake: string } | null;
};

/** Safe, backend-authoritative error text. Provider/internal detail is never shown. */
export type CasinoError = { code: string; message: string };

const MESSAGES: Record<string, string> = {
  INSUFFICIENT_VIRTUAL_BALANCE: 'Not enough virtual points.',
  STAKE_ABOVE_MAXIMUM: 'That stake is above the maximum.',
  STAKE_BELOW_MINIMUM: 'That stake is below the minimum.',
  INVALID_STAKE: 'Enter a whole number of points.',
  INVALID_TARGET: 'Choose a target inside the allowed range.',
  INVALID_MINE_COUNT: 'Choose an allowed number of mines.',
  ROUND_ALREADY_OPEN: 'Finish your current game first.',
  ROUND_NOT_OPEN: 'That round has already finished.',
  CELL_ALREADY_REVEALED: 'That cell is already revealed.',
  NOTHING_REVEALED: 'Reveal at least one cell before cashing out.',
  ROUND_NOT_FOUND: 'Round not found.',
  CASINO_MAINTENANCE: 'The casino is temporarily unavailable.',
  CASINO_GAME_DISABLED: 'This game is currently unavailable.',
  CASINO_GAME_MAINTENANCE: 'This game is under maintenance.',
  CASINO_GAME_NOT_FOUND: 'That game does not exist.',
  RATE_LIMITED: 'You are playing very quickly. Please wait a moment.',
};

export function describeError(error: CasinoError | undefined) {
  if (!error) return 'Something went wrong. Please try again.';
  return MESSAGES[error.code] ?? error.message ?? 'Something went wrong. Please try again.';
}

/**
 * Every casino call goes through the authenticated API. The browser never
 * computes or submits a result, a multiplier, or a payout.
 */
export async function casinoPost<T>(path: string, body: Record<string, unknown>) {
  const response = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  const payload = (await response.json().catch(() => undefined)) as T & Partial<CasinoError>;
  if (!response.ok) throw payload as CasinoError;
  return payload as T;
}

export async function casinoDelete<T>(path: string) {
  const response = await apiFetch(path, { method: 'DELETE' });
  const payload = (await response.json().catch(() => undefined)) as T & Partial<CasinoError>;
  if (!response.ok) throw payload as CasinoError;
  return payload as T;
}

export async function casinoGet<T>(path: string): Promise<T | null> {
  const response = await apiFetch(path);
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

export async function casinoGetRequired<T>(path: string): Promise<T> {
  const value = await casinoGet<T>(path);
  if (value === null) throw new Error('CASINO_BACKEND_UNAVAILABLE');
  return value;
}

export async function fetchBalance() {
  const wallet = await casinoGet<{ balance: string }>('/wallet/me');
  return wallet?.balance ?? '0';
}

export const formatPoints = (value: string | number) =>
  Number(value).toLocaleString('en-US');

export const newIdempotencyKey = () => crypto.randomUUID();
