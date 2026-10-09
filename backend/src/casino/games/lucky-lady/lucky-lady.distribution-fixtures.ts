import { canonicalProfileHash } from '../../platform/math-control/math-control.analytics';
import {
  DISTRIBUTION_CLASSES,
  type DistributionClass,
  type DistributionPolicy,
} from '../../platform/math-control/payout-distribution';
import type { MathPolicy, MathProfileArtifact } from '../../platform/math-control/math-control.types';
import type { LlProfilePayload } from './lucky-lady.exact';
import { loadVerifiedMath, type RulesTable } from './lucky-lady.math';

/**
 * Offline behaviour fixtures for the payout-policy bridge.
 *
 * Every fixture is an **honest, canonical-hashed test artifact** - never a
 * generated, validated or activated live profile. They exist so the accepted
 * bankroll simulator can be driven by real reachable boards under a payout
 * policy, and so the resulting report can be compared across return shapes.
 *
 * `targetRtpPercent` in each artifact's `MathPolicy` is nominal and unused:
 * these fixtures were not calibrated to a target, and the report carries the
 * *expected* return derived from the policy's exact support next to the
 * *measured* return of the simulated sessions.
 */

export type PolicyFixture = {
  fixtureId: string;
  label: string;
  description: string;
  expectation: string;
  sessions: number;
  horizonPaidSpins: number;
  policy: DistributionPolicy;
  artifact: MathProfileArtifact;
  payload: LlProfilePayload;
};

/** Real reachable stop combinations, one per canonical class (bet 1, 10 lines). */
const BOARD = {
  LOSS: [120, 58, 23, 5, 116],
  PARTIAL_LOW: [70, 119, 63, 118, 95],
  PARTIAL_HIGH: [72, 87, 118, 3, 55],
  BREAK_EVEN: [97, 80, 32, 64, 11],
  SMALL: [38, 61, 49, 73, 122],
  MEDIUM: [85, 72, 47, 80, 37],
  BIG: [11, 50, 52, 100, 116],
} as const;

/** The proved 50x ceiling board and a dead board for the sparse feature fixture. */
const CEILING_50 = [67, 51, 13, 33, 33];
const DEAD = [63, 119, 102, 60, 108];

const { hashes, profile } = loadVerifiedMath();

const reelKeysFor = (rules: RulesTable): string[] => {
  const strips = rules.reels as Record<string, string[]>;
  return Object.keys(strips).sort(
    (a, b) => Number(a.replace('reelStrip', '')) - Number(b.replace('reelStrip', '')),
  );
};

/** A payload whose reachable boards are the per-reel union of the listed boards. */
function unionPayload(rules: RulesTable, boards: ReadonlyArray<readonly number[]>): LlProfilePayload {
  const strips = rules.reels as Record<string, string[]>;
  const stopWeights: Record<string, number[]> = {};
  reelKeysFor(rules).forEach((key, index) => {
    const weights = new Array(strips[key].length - 2).fill(0);
    for (const board of boards) weights[board[index]] += 1;
    stopWeights[key] = weights;
  });
  return { stopWeights };
}

/**
 * The sparse feature fixture: only reels 1-3 can land dead and reels 4-5 have a
 * single reachable stop, so the FEATURE_TRIGGER class has exactly one reachable
 * member - the proved 50x ceiling board. Reels 1-2 carry equal weight so the
 * free-spin chain really pays (a free spin lands a paying board about 27% of the
 * time), while the chain stays firmly subcritical: p(trigger) = 1/84, so
 * 15 x p = 0.179.
 */
function featurePayload(rules: RulesTable): LlProfilePayload {
  const strips = rules.reels as Record<string, string[]>;
  const stopWeights: Record<string, number[]> = {};
  reelKeysFor(rules).forEach((key, index) => {
    const weights = new Array(strips[key].length - 2).fill(0);
    weights[CEILING_50[index]] += 1;
    if (index === 2) weights[DEAD[index]] += 20;
    else if (index < 2) weights[DEAD[index]] += 1;
    stopWeights[key] = weights;
  });
  return { stopWeights };
}

const artifactPolicy = (maxWinMultiplier: number): MathPolicy => ({
  gameId: 'lucky-lady',
  // Nominal only: these fixtures are never calibrated, validated or activated.
  targetRtpPercent: 50,
  maxWinMultiplier,
  maxWinScope: 'RESOLVED_SPIN',
  maxWinEnabled: true,
  pacing: 'BALANCED',
  customPacing: null,
  hitRate: { mode: 'AUTO' },
  partialReturn: 'LOW',
  volatility: 'MED',
  bigWinMinMultiplier: 10,
  bigWinMaxMultiplier: 50,
  featureContribution: { minPercent: 0, maxPercent: 60 },
  presets: [],
});

const artifactFor = (
  fixtureId: string,
  payload: LlProfilePayload,
  maxWinMultiplier: number,
): MathProfileArtifact => {
  const artifact: MathProfileArtifact = {
    schemaVersion: 1,
    profileId: `lucky-lady.test.payout-policy.${fixtureId}`,
    gameId: 'lucky-lady',
    engineSha256: hashes.engineSha256,
    rulesSha256: hashes.rulesSha256,
    policy: artifactPolicy(maxWinMultiplier),
    payload,
    canonicalHash: '',
    createdAt: new Date(0).toISOString(),
  };
  artifact.canonicalHash = canonicalProfileHash(artifact);
  return artifact;
};

const weightsFor = (
  overrides: Partial<Record<DistributionClass, number>>,
): DistributionPolicy['weights'] =>
  DISTRIBUTION_CLASSES.reduce(
    (accumulator, cls) => ({ ...accumulator, [cls]: overrides[cls] ?? 0 }),
    {} as DistributionPolicy['weights'],
  );

type FixtureSpec = {
  fixtureId: string;
  label: string;
  description: string;
  expectation: string;
  sessions: number;
  horizonPaidSpins: number;
  maxWinMultiplier: number;
  maxBandMin: number;
  weights: Partial<Record<DistributionClass, number>>;
  payload: (rules: RulesTable) => LlProfilePayload;
};

const SPECS: FixtureSpec[] = [
  {
    fixtureId: 'test-loss-100',
    label: 'LOSS 100%',
    description: 'every paid round resolves the zero-return board; the account can fund exactly 500 staked rounds',
    expectation: 'exactly 500 paid spins, 100.00 PTS turnover, zero ending balance, 0% return',
    sessions: 120,
    horizonPaidSpins: 10_000,
    maxWinMultiplier: 50,
    maxBandMin: 20,
    weights: { LOSS: 10_000 },
    payload: (rules) => unionPayload(rules, [BOARD.LOSS]),
  },
  {
    fixtureId: 'test-break-even-100',
    label: 'BREAK_EVEN 100%',
    description: 'every paid round returns exactly the paid stake; the balance is unchanged and the session censors',
    expectation: '100.00 PTS retained, 100% return, censored at the horizon',
    sessions: 120,
    horizonPaidSpins: 10_000,
    maxWinMultiplier: 50,
    maxBandMin: 20,
    weights: { BREAK_EVEN: 10_000 },
    payload: (rules) => unionPayload(rules, [BOARD.BREAK_EVEN]),
  },
  {
    fixtureId: 'test-retention',
    label: 'RETENTION (loss + partial + small)',
    description: 'a low-but-nonzero return shape with meaningful partial and small returns over a bounded loss/partial-low/small support, not tuned for any optimum',
    expectation: 'a slow negative drift; partial and small returns populate their classes',
    sessions: 120,
    horizonPaidSpins: 10_000,
    maxWinMultiplier: 50,
    maxBandMin: 20,
    weights: { LOSS: 6_000, PARTIAL_LOW: 2_000, PARTIAL_HIGH: 500, SMALL: 1_500 },
    // The same bounded support as TIGHT: every reachable board (and every
    // reachable free spin) stays inside a 50x per-resolution ceiling.
    payload: (rules) => unionPayload(rules, [BOARD.LOSS, BOARD.PARTIAL_LOW, BOARD.SMALL]),
  },
  {
    fixtureId: 'test-high-return',
    label: 'HIGH_RETURN (loss + partial + wins)',
    description: 'losses and partial returns coexist with medium and big wins; expected return is well above 100% and not flat 1x',
    expectation: 'a strongly positive drift with losses still present in every session',
    sessions: 120,
    horizonPaidSpins: 10_000,
    maxWinMultiplier: 500,
    maxBandMin: 50,
    weights: { LOSS: 4_000, PARTIAL_LOW: 1_000, SMALL: 2_000, MEDIUM: 2_000, BIG: 1_000 },
    payload: (rules) => unionPayload(rules, [BOARD.LOSS, BOARD.PARTIAL_LOW, BOARD.SMALL, BOARD.MEDIUM, BOARD.BIG]),
  },
  {
    fixtureId: 'test-tight',
    label: 'TIGHT (higher loss)',
    description: 'a low-return, loss-heavy reachable shape used to compare ruin timing against the other policies',
    expectation: 'fast ruin with only occasional partial and small returns',
    sessions: 120,
    horizonPaidSpins: 10_000,
    maxWinMultiplier: 50,
    maxBandMin: 20,
    weights: { LOSS: 8_000, PARTIAL_LOW: 1_500, SMALL: 500 },
    payload: (rules) => unionPayload(rules, [BOARD.LOSS, BOARD.PARTIAL_LOW, BOARD.SMALL]),
  },
  {
    fixtureId: 'test-feature-mix',
    label: 'FEATURE_MIX (loss + small + medium + trigger)',
    description: 'a modest feature frequency over the proved sparse fixture: one real trigger board, a paying native free-spin chain with a subcritical retrigger probability, and a tight 50x per-resolution cap',
    expectation: 'feature payouts credited to the triggering round with no extra wager',
    sessions: 60,
    horizonPaidSpins: 10_000,
    maxWinMultiplier: 50,
    maxBandMin: 20,
    weights: { LOSS: 8_760, SMALL: 1_000, MEDIUM: 200, FEATURE_TRIGGER: 40 },
    payload: featurePayload,
  },
];

export const PAYOUT_POLICY_FIXTURES: PolicyFixture[] = (() => {
  const { rules } = loadVerifiedMath();
  return SPECS.map((spec) => {
    const payload = spec.payload(rules);
    const artifact = artifactFor(spec.fixtureId, payload, spec.maxWinMultiplier);
    const policy: DistributionPolicy = {
      policyId: `lucky-lady.${spec.fixtureId}`,
      version: 1,
      gameId: 'lucky-lady',
      mathProfileId: artifact.profileId,
      mathProfileHash: artifact.canonicalHash,
      maxWinScope: 'RESOLVED_SPIN',
      maxWinMultiplier: spec.maxWinMultiplier,
      granularity: 10_000,
      maxBandMin: spec.maxBandMin,
      weights: weightsFor(spec.weights),
    };
    return {
      fixtureId: spec.fixtureId,
      label: spec.label,
      description: spec.description,
      expectation: spec.expectation,
      sessions: spec.sessions,
      horizonPaidSpins: spec.horizonPaidSpins,
      policy,
      artifact,
      payload,
    };
  });
})();

/**
 * The accepted frozen RTP50 profile, referenced for honesty only.
 *
 * Its pre-draw weights cover every stop of every reel, so a bounded exact
 * enumeration cannot preserve its semantics. The evidence run attempts the
 * bounded build and records the refusal verbatim rather than pretending a
 * class-equivalent fixture.
 */
export const FROZEN_RTP50_REFERENCE = {
  label: 'FROZEN RTP50 (accepted)',
  profileId: profile.id,
  profileHash: profile.canonicalHash,
  payload: {
    stopWeights: (profile as unknown as { stopWeights?: Record<string, number[]> }).stopWeights,
  } as LlProfilePayload,
  note:
    'the accepted dense RTP50 profile cannot be represented by the bounded 4096-board index; no payout-policy ' +
    'sessions are claimed for it here. The historical 20M-round run measured 49.8624% under a different ' +
    'methodology and is not a substitute for current sessions.',
} as const;
