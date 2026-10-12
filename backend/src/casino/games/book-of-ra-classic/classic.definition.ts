import { CLASSIC_ID, RULES } from './classic.engine';

/**
 * Registry and configuration identity for the imported Classic client.
 *
 * The mathematics is frozen: one clean-math unit is one platform point, the
 * native nine-line paytable is the one recovered from the reference server, and
 * the per-line ladder is 1/2/5/10/20 points with 1..9 lines selected, so a paid
 * round wagers 1..180 points. Operators may change availability, never the
 * return, the line count that a profile was validated at, or the denomination.
 */
export const CLASSIC_V1 = {
  gameId: CLASSIC_ID,
  /** The line count every Classic profile is enumerated and validated at. */
  lines: RULES.paylines.length,
  /** Selectable line counts: the native `gameLine` ladder. */
  lineCounts: [1, 2, 3, 4, 5, 6, 7, 8, 9] as const,
  /** Per-line ladder in platform points. */
  lineStakes: [1, 2, 5, 10, 20] as const,
  minStake: 1n,
  maxStake: 180n,
  declaredRtpBps: 5_000,
  profileId: 'book-of-ra-classic.rtp50.v1',
  /** Round identity prefix; `GameRoundService` scopes rounds by `gameId.`. */
  version: 'book-of-ra-classic.v1',
} as const;

export const classicVersion = () => CLASSIC_V1.version;
