import { FROZEN_PROFILE_CANONICAL_HASH, LUCKY_LADY_GAME_ID, LUCKY_LADY_LINES } from './lucky-lady.math';

/**
 * Registry and configuration identity for the imported game.
 *
 * The mathematics is frozen: one clean-math unit is one platform point, ten
 * lines are always active, and the native per-line ladder is 1/2/5/10/20
 * points, so a paid round wagers 10..200 points. Operators may change
 * availability and the stake ceiling, never the return.
 */
export const LUCKY_LADY_V1 = {
  gameId: LUCKY_LADY_GAME_ID,
  lines: LUCKY_LADY_LINES,
  /** Per-line ladder in platform points (native 0.01/0.02/0.05/0.10/0.20). */
  lineStakes: [1, 2, 5, 10, 20] as const,
  minStake: 10n,
  maxStake: 200n,
  declaredRtpBps: 5_000,
  profileId: 'lucky-lady.rtp50.v1',
  profileHash: FROZEN_PROFILE_CANONICAL_HASH,
  version: 'lucky-lady.rtp50.v1',
} as const;

export const luckyLadyVersion = () => LUCKY_LADY_V1.version;
