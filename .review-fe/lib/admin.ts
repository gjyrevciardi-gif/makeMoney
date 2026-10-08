import { apiFetch } from './api';

/**
 * Administrator API helpers.
 *
 * Every call is authenticated as the signed-in administrator; no identity is
 * ever sent in a request body. The backend independently re-checks the ADMIN
 * role on each mutation, so this layer is convenience, never authority.
 */

export type RtpControl = 'DIRECT' | 'PROFILE' | 'CANONICAL' | 'RULE_BASED';

export type ConfigVersion = {
  versionId: string;
  version: number;
  label: string;
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
  minStake: string;
  maxStake: string;
  rtpBps: number | null;
  houseEdgeBps: number | null;
  rtpPercent: string | null;
  gameSpecific: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
  activatedAt: string | null;
  supersededAt: string | null;
  createdBy?: { id: string; email: string } | null;
};

export type GameConfig = {
  gameId: string;
  name: string;
  category: string | null;
  gameType: string | null;
  rtpControl: RtpControl;
  rtpBounds: { minBps: number; maxBps: number };
  enabled: boolean;
  maintenance: boolean;
  activeVersion: ConfigVersion | null;
};

export type ConfigList = {
  platform: {
    casinoMaintenance: boolean;
    sportsbookMaintenance: boolean;
    updatedAt: string;
  };
  games: GameConfig[];
};

export type Analytics = {
  period: string;
  since: string | null;
  totals: {
    totalRounds: number;
    wins: number;
    losses: number;
    activeRounds: number;
    totalWagered: string;
    totalReturned: string;
    houseResult: string;
    observedRtp: string | null;
    observedRtpPercent: string | null;
  };
  games: {
    gameType: string;
    configVersion: string;
    theoreticalRtpBps: number | null;
    theoreticalRtpPercent: string | null;
    houseEdgeBps: number | null;
    houseEdgePercent: string | null;
    rounds: number;
    totalWagered: string;
    totalReturned: string;
    observedRtp: string | null;
    observedRtpPercent: string | null;
    houseResult: string;
  }[];
  note: string;
};

export type AdminUser = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  wallet: { balance: string } | null;
};

export type AdminError = { code: string; message: string };

export async function adminGet<T>(path: string): Promise<T | null> {
  const response = await apiFetch(path);
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as T | null;
}

export async function adminSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await apiFetch(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => undefined)) as T & Partial<AdminError>;
  if (!response.ok) throw payload as AdminError;
  return payload as T;
}

const MESSAGES: Record<string, string> = {
  ADMIN_REQUIRED: 'Administrator access is required.',
  CONFIG_VERSION_CONFLICT: 'Someone else changed this game. Reload and try again.',
  CONFIG_ALREADY_ACTIVE: 'That version is already active.',
  CONFIG_VERSION_SUPERSEDED: 'A superseded version cannot be reactivated.',
  RTP_OUT_OF_RANGE: 'That return is outside the allowed range.',
  RTP_REQUIRED: 'This game needs a return value.',
  INVALID_STAKE_LIMITS: 'Check the stake limits.',
  ROULETTE_RTP_IS_CANONICAL: 'Roulette pays 36/37 by its own rules and cannot be dialled.',
  BLACKJACK_RTP_IS_RULE_BASED: 'Blackjack return follows its rules, not a dial.',
  UNKNOWN_SLOT_PROFILE: 'Choose one of the approved slot profiles.',
  SLOT_PROFILE_RTP_MISMATCH: 'That profile failed its exact return check.',
};

export function describeAdminError(error: AdminError | undefined) {
  if (!error) return 'Something went wrong. Please try again.';
  return MESSAGES[error.code] ?? error.message ?? 'Something went wrong. Please try again.';
}

export const formatPoints = (value: string | number | null | undefined) =>
  value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US');

export const newIdempotencyKey = () => crypto.randomUUID();

/** How an operator may influence each game's return, in plain words. */
export const RTP_CONTROL_LABEL: Record<RtpControl, string> = {
  DIRECT: 'Return is configurable',
  PROFILE: 'Approved profiles only',
  CANONICAL: 'Fixed by the rules of the game',
  RULE_BASED: 'Determined by the rules and player choices',
};
