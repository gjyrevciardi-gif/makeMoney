import { CasinoGameId } from './casino-game.registry';

/**
 * The effective, administrator-controlled configuration of one game.
 *
 * `versionLabel` is what every round records, so a settled round can always be
 * resolved back to the exact mathematics that produced it even after an
 * operator activates something different.
 */
export type EffectiveGameConfig = {
  gameId: CasinoGameId;
  enabled: boolean;
  maintenance: boolean;
  minStake: bigint;
  maxStake: bigint;
  /** Null for games whose return follows canonical rules rather than a dial. */
  rtpBps: number | null;
  gameSpecific: Record<string, unknown>;
  versionLabel: string;
  versionId: string | null;
  versionNumber: number;
};

/** How an operator may influence a game's return, if at all. */
export type RtpControl =
  /** A dial: the payout formula consumes rtpBps directly. */
  | 'DIRECT'
  /** A choice between pre-approved, exactly validated mathematical profiles. */
  | 'PROFILE'
  /** Fixed by the published rules; only limits and availability are editable. */
  | 'CANONICAL'
  /** Strategy-dependent; no single theoretical RTP is published. */
  | 'RULE_BASED';

export type GameConfigCandidate = {
  minStake: bigint;
  maxStake: bigint;
  rtpBps: number | null;
  gameSpecific: Record<string, unknown>;
};

export class CasinoConfigError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}
