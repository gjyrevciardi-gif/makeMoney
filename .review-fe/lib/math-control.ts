import { adminGet, adminSend } from './admin';

/**
 * Admin RTP Control client for Lucky Lady's generated payout policy.
 *
 * Convenience only. The backend independently re-checks the ADMIN role in the
 * database, solves the policy itself, produces the evidence report itself, and
 * refuses activation without a stored VALIDATED candidate whose frozen hashes
 * still match. Nothing here can choose an outcome, a weight, or a result.
 */

export const LUCKY_LADY_PAYOUT_BASE = '/admin/casino/math/lucky-lady/payout';

export const PAYOUT_STYLES = ['RETENTION', 'BALANCED', 'VOLATILE', 'CUSTOM'] as const;
export type PayoutStyle = (typeof PAYOUT_STYLES)[number];
export const PAYOUT_MAX_WIN = [20, 50] as const;

export type PayoutClassWeight = { classId: string; units: number; percent: number };

export type PayoutCandidateView = {
  candidateId: string;
  status: string;
  activated: boolean;
  targetRtpPercent: number;
  declaredReturnPercent: number;
  maxWinMultiplier: number;
  style: string;
  policyId: string | null;
  policyHash: string | null;
  modelId: string | null;
  modelHash: string | null;
  requestHash: string | null;
  weights: PayoutClassWeight[];
  reasons: { constraint: string; requested: string; achievable: string; detail: string }[];
  stages: { stage: string; detail: string }[];
  createdAt: string;
};

export type PayoutReportMetrics = {
  requestedRtpPercent: number;
  declaredReturnPercent: number;
  expectedRtpPercent: number | null;
  expectedRtpPercentExact: string;
  measuredRtpPercent: number | null;
  measuredRtpPercentExact: string;
  rtpStandardErrorPercent: number | null;
  rtp95IntervalPercent: [number, number] | null;
  absoluteDifferencePercent: number | null;
  verdict: string;
  tolerance: string;
  houseEdgePercent: number | null;
  houseEdgePercentExact: string;
  hitRate: number;
  partialRate: number;
  breakEvenRate: number;
  lossRate: number;
  profitableRate: number;
  featureTriggerRate: number;
  retriggerRate: number;
  paidSessionLength: { median: number | null; p90: number | null };
  turnoverPts: { median: number | null; mean: number | null };
  alive500: number | null;
  alive1000: number | null;
  alive5000: number | null;
  houseResultPts: { mean: number | null; median: number | null };
  houseResultUnitsMedian: number | null;
  fullLossStreak: { p90: number | null; p95: number | null };
  nonProfitableStreakP90: number | null;
  drySpellDefinitions: { fullLoss: string; nonProfitable: string };
  drawdownP90: number | null;
  maxPaidSpinUnitsExact: string;
  maxFreeSpinUnitsExact: string;
  maxFeatureChainUnitsExact: string;
  capUnitsExact: string;
  paidSpinWithinCap: boolean;
  freeSpinWithinCap: boolean;
  featureAggregateExceedsCap: boolean;
  maxWinWasCapped: boolean;
  sampleSessions: number;
  sampleHorizonPaidSpins: number;
  censoredCount: number;
  censoringCaveat: string;
};

export type PayoutActiveState = {
  mode: 'DEFAULT' | 'CUSTOM';
  /** True when the active mathematics came from the shared lifecycle, not this panel. */
  legacy: boolean;
  version: number;
  profileId: string | null;
  profileHash: string | null;
  validationId: string | null;
  policyId: string | null;
  policyHash: string | null;
  modelId: string | null;
  modelHash: string | null;
  targetRtpPercent: number | null;
  maxWinMultiplier: number | null;
  style: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  note: string;
};

export type PayoutCurrent = {
  gameId: string;
  active: PayoutActiveState;
  defaultProfile: {
    profileId: string;
    profileHash: string;
    rtpPercent: number | null;
    maxWinMultiplier: number | null;
    maxWinScope: string;
    maxWinEnabled: boolean | null;
    note: string;
  };
  candidateCount: number;
};

export type PayoutPreview = {
  candidate: PayoutCandidateView;
  report: Record<string, unknown>;
  metrics: PayoutReportMetrics | null;
  artifactPath: string;
};

export type PayoutHistoryEntry = {
  id: string;
  actionId: string;
  action: string;
  version: number;
  candidateId: string | null;
  profileId: string | null;
  policyHash: string | null;
  modelHash: string | null;
  targetRtpPercent: number | null;
  maxWinMultiplier: number | null;
  style: string | null;
  previous: {
    mode: 'DEFAULT' | 'CUSTOM';
    version: number;
    profileId: string | null;
    candidateId: string | null;
    policyId: string | null;
    targetRtpPercent: number | null;
  };
  actorId: string;
  createdAt: string;
};

export type PayoutGenerateOutcome =
  | { status: 'VALIDATED'; candidate: PayoutCandidateView; metrics: PayoutReportMetrics }
  | {
      status: 'GENERATED' | 'SEARCH_EXHAUSTED' | 'INFEASIBLE' | 'REJECTED';
      candidate: PayoutCandidateView | null;
      metrics: PayoutReportMetrics | null;
      reasons: PayoutCandidateView['reasons'];
      message: string;
    };

export type PayoutActivationResult = {
  gameId: string;
  action: 'ACTIVATE' | 'ROLLBACK' | 'DEFAULT';
  replay: boolean;
  version: number;
  active: PayoutActiveState;
};

export const payoutCurrent = () => adminGet<PayoutCurrent>(`${LUCKY_LADY_PAYOUT_BASE}/current`);

export const payoutHistory = () =>
  adminGet<{ gameId: string; entries: PayoutHistoryEntry[] }>(`${LUCKY_LADY_PAYOUT_BASE}/history`);

export const payoutCandidates = () =>
  adminGet<{ gameId: string; candidates: PayoutCandidateView[] }>(`${LUCKY_LADY_PAYOUT_BASE}/candidates`);

export const generatePayoutCandidate = (input: {
  targetRtpPercent: number;
  maxWinMultiplier: 20 | 50;
  style: PayoutStyle;
  constraints?: Record<string, unknown>;
}) => adminSend<PayoutGenerateOutcome>(`${LUCKY_LADY_PAYOUT_BASE}/generate`, 'POST', input);

export const payoutPreview = (candidateId: string) =>
  adminGet<PayoutPreview>(`${LUCKY_LADY_PAYOUT_BASE}/candidates/${encodeURIComponent(candidateId)}`);

export const activatePayout = (candidateId: string, actionId: string, expectedVersion: number) =>
  adminSend<PayoutActivationResult>(
    `${LUCKY_LADY_PAYOUT_BASE}/candidates/${encodeURIComponent(candidateId)}/activate`,
    'POST',
    { actionId, expectedVersion },
  );

export const rollbackPayout = (actionId: string, expectedVersion: number) =>
  adminSend<PayoutActivationResult>(`${LUCKY_LADY_PAYOUT_BASE}/rollback`, 'POST', { actionId, expectedVersion });

export const restoreDefaultPayout = (actionId: string, expectedVersion: number) =>
  adminSend<PayoutActivationResult>(`${LUCKY_LADY_PAYOUT_BASE}/default`, 'POST', { actionId, expectedVersion });

export const percent = (value: number | null | undefined, digits = 3) =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : `${value.toFixed(digits)}%`;

export const ratio = (value: number | null | undefined, digits = 4) =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(digits);

export const number = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(digits);

export const points = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : value.toFixed(digits);
