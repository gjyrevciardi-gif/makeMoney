import type { DistributionClass } from '../../../platform/math-control/payout-distribution';
import type { PolicyBankrollReport } from '../../../platform/math-control/payout-policy-bankroll';
import type { GeneratedPolicyReport } from '../lucky-lady.policy-generator';

/**
 * Admin RTP Control panel: shared response shapes.
 *
 * All of these describe server-produced evidence. Nothing here is an input an
 * operator may assert: a candidate is a frozen generator artifact, its report
 * is the accepted simulator's output, and the active/default state is read from
 * the durable pointer.
 */

export const LUCKY_LADY_PAYOUT_GAME_ID = 'lucky-lady';

/** The styles the accepted generator solves for. */
export const LUCKY_LADY_PAYOUT_STYLES = ['RETENTION', 'BALANCED', 'VOLATILE', 'CUSTOM'] as const;
export type LuckyLadyPayoutStyle = (typeof LUCKY_LADY_PAYOUT_STYLES)[number];

/** Actual bounded support of the declared generator model. */
export const LUCKY_LADY_PAYOUT_SUPPORTED_MAX_WIN = [20, 50] as const;

export type LifecycleAction = 'ACTIVATE' | 'ROLLBACK' | 'DEFAULT';

/** Displayed class weights, reconciled to exactly 100% by the server. */
export type PayoutClassWeight = {
  classId: DistributionClass;
  units: number;
  percent: number;
};

export type PayoutReportMetrics = {
  requestedRtpPercent: number;
  /** The immutable declared model's own complete-round return. */
  declaredReturnPercent: number;
  /** The exact expected return of the frozen class distribution. */
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
  /** The exact-unit counterpart of `houseResultPts.median`, kept for audit. */
  houseResultUnitsMedian: number | null;
  fullLossStreak: { p90: number | null; p95: number | null };
  nonProfitableStreakP90: number | null;
  /** The server's own definition strings, shown verbatim so the labels are honest. */
  drySpellDefinitions: { fullLoss: string; nonProfitable: string };
  drawdownP90: number | null;
  /** The single largest paid-spin resolution seen, separate from the chain. */
  maxPaidSpinUnitsExact: string;
  maxFreeSpinUnitsExact: string;
  maxFeatureChainUnitsExact: string;
  capUnitsExact: string;
  paidSpinWithinCap: boolean;
  freeSpinWithinCap: boolean;
  featureAggregateExceedsCap: boolean;
  /** Paid-spin-first `paid`: `cap` shown together so a chain overrun is visible. */
  maxWinWasCapped: boolean;
  sampleSessions: number;
  sampleHorizonPaidSpins: number;
  censoredCount: number;
  censoringCaveat: string;
};

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
  /** Reconciled to exactly 100%; empty when the candidate did not solve. */
  weights: PayoutClassWeight[];
  reasons: { constraint: string; requested: string; achievable: string; detail: string }[];
  stages: { stage: string; detail: string }[];
  createdAt: string;
};

export type PayoutPreviewView = {
  candidate: PayoutCandidateView;
  report: GeneratedPolicyReport;
  metrics: PayoutReportMetrics | null;
  artifactPath: string;
};

export type PayoutActiveState = {
  mode: 'DEFAULT' | 'CUSTOM';
  /** True when the active mathematics came from the shared lifecycle, not this panel. */
  legacy: boolean;
  /** The monotonic pointer revision a stale client must match to mutate. */
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
  /** Only NEW paid rounds follow this; rounds in flight keep their pin. */
  note: string;
};

export type PayoutCurrentView = {
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

export type PayoutActivationResult = {
  gameId: string;
  action: LifecycleAction;
  replay: boolean;
  version: number;
  active: PayoutActiveState;
};

export type PayoutGenerateOutcome =
  | { status: 'VALIDATED'; candidate: PayoutCandidateView; metrics: PayoutReportMetrics }
  | {
      status: 'GENERATED' | 'SEARCH_EXHAUSTED' | 'INFEASIBLE' | 'REJECTED';
      candidate: PayoutCandidateView;
      metrics: PayoutReportMetrics | null;
      reasons: PayoutCandidateView['reasons'];
      /** Search exhaustion never implies the request is mathematically impossible. */
      message: string;
    };

export type StoredDistribution = {
  policyId: string;
  policyHash: string;
  weights: PayoutClassWeight[];
};

export type { PolicyBankrollReport };
