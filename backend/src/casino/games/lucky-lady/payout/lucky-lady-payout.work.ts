import { createHash } from 'node:crypto';
import { defaultSessionConfig } from '../../../platform/math-control/math-control.bankroll';
import type { SessionConfig } from '../../../platform/math-control/math-control.types';
import {
  GENERATED_SAMPLE_HORIZON,
  GENERATED_SAMPLE_SESSIONS,
  generateLuckyLadyPolicy,
  runGeneratedPolicyEvidence,
  type GeneratedPolicyReport,
  type LuckyLadyGeneratorCandidate,
} from '../lucky-lady.policy-generator';

/**
 * Bounded generator + evidence run for one payout candidate.
 *
 * The whole thing is deterministic: the solver enumerates a bounded support, and
 * the evidence cohort uses predeclared sessions x horizon with a seed prefix
 * derived from the frozen policy hash. No seed is ever searched and no target
 * matrix is walked, so the work stays inside the shared job runner's envelope.
 */

export const PAYOUT_EVIDENCE_SESSIONS = GENERATED_SAMPLE_SESSIONS; // 80
export const PAYOUT_EVIDENCE_HORIZON = GENERATED_SAMPLE_HORIZON; // 5_000

export const payoutEvidenceSeedPrefix = (policyHash: string) => `generated:${policyHash}:v1`;

export const payoutEvidenceGeneratedAt = (policyHash: string): string => {
  // Deterministic derivation from the frozen candidate identity, never a clock
  // read, so replaying the same candidate replays the identical report.
  const digest = createHash('sha256').update(`payout-generated-at:${policyHash}`).digest('hex');
  const yearMs = 365n * 24n * 60n * 60n * 1000n;
  const offsetMs = Number(BigInt(`0x${digest.slice(0, 12)}`) % yearMs);
  return new Date(Date.UTC(2026, 0, 1) + offsetMs).toISOString();
};

export function payoutEvidenceSessionConfig(horizon = PAYOUT_EVIDENCE_HORIZON): SessionConfig {
  return { ...defaultSessionConfig(), horizonPaidSpins: horizon };
}

export type PayoutWorkResult = {
  candidate: LuckyLadyGeneratorCandidate;
  report: GeneratedPolicyReport;
  sessions: number;
  horizonPaidSpins: number;
  seedPrefix: string;
};

export function runLuckyLadyPayoutWork(
  request: unknown,
  semanticConstraints?: Parameters<typeof generateLuckyLadyPolicy>[0]['semanticConstraints'],
): PayoutWorkResult {
  const candidate = generateLuckyLadyPolicy({ request, semanticConstraints });
  const policyHash = candidate.policyHash ?? 'unsolved';
  const sessions = PAYOUT_EVIDENCE_SESSIONS;
  const horizonPaidSpins = PAYOUT_EVIDENCE_HORIZON;
  const seedPrefix = payoutEvidenceSeedPrefix(policyHash);
  const generatedAt = payoutEvidenceGeneratedAt(policyHash);
  const report = runGeneratedPolicyEvidence(candidate, {
    sessions,
    horizonPaidSpins,
    seedPrefix,
    generatedAt,
    sessionConfig: payoutEvidenceSessionConfig(horizonPaidSpins),
  });
  return { candidate, report, sessions, horizonPaidSpins, seedPrefix };
}
