function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

/**
 * Operational thresholds are read per call so that deployment configuration and
 * integration tests can change them without rebuilding the dependency graph.
 */
export const sportsOperationsConfig = () => ({
  staleBetAfterMinutes: boundedInteger(
    process.env.SPORTS_STALE_BET_AFTER_MINUTES,
    180,
    1,
    7 * 24 * 60,
  ),
  lowQuotaThreshold: boundedInteger(process.env.SPORTS_LOW_QUOTA_THRESHOLD, 100, 0, 1_000_000),
  settlementEnabled: process.env.SPORTS_SETTLEMENT_ENABLED === 'true',
  pollSeconds: boundedInteger(process.env.SPORTS_SETTLEMENT_POLL_SECONDS, 300, 30, 3_600),
});
