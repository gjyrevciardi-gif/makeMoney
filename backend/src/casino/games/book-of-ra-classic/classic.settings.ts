import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLASSIC_V1 } from './classic.definition';
import { defaultClassicProfile } from './classic.math-adapter';

function load(name: string): Record<string, unknown> {
  const path = [
    join(__dirname, 'math', name),
    join(process.cwd(), 'backend/src/casino/games/book-of-ra-classic/math', name),
    join(process.cwd(), 'src/casino/games/book-of-ra-classic/math', name),
  ].find(existsSync);
  if (!path) throw Error('CLASSIC_SETTINGS_MISSING');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** The mathematics the settings screen reports, or `null` for the frozen default. */
export type ClassicReportedMath = {
  profileId: string;
  profileHash: string;
  targetRtpPercent: number;
  validatedLines: number;
} | null;

/**
 * The native `getSettings` payload.
 *
 * The recovered client reads its whole configuration from this document, so the
 * stake and line ladders are written from the frozen identity rather than from
 * whatever the recovered file happens to contain, and the reported mathematics
 * is the profile a *new* round will actually pin. When an operator has
 * activated nothing, that is the frozen Classic artefact.
 */
export function nativeSettings(active: ClassicReportedMath = null) {
  const profile = defaultClassicProfile();
  const settings = load('settings.json');
  // Whole points, exactly as the native ladder and the ledger debit.
  settings.Bet = [...CLASSIC_V1.lineStakes];
  settings.Line = [...CLASSIC_V1.lineCounts];
  settings.gameLine = [...CLASSIC_V1.lineCounts];
  const reported = active ?? {
    profileId: profile.id,
    profileHash: profile.hash,
    targetRtpPercent: profile.payload.targetRtpPercent,
    validatedLines: CLASSIC_V1.lines,
  };
  settings.mathConfig = {
    gameId: CLASSIC_V1.gameId,
    rtpControlEnabled: true,
    targetRtpPercent: reported.targetRtpPercent,
    activeMathProfile: reported.profileId,
    profileHash: reported.profileHash,
    validatedLines: reported.validatedLines,
    stakeUnit: 'WHOLE_POINTS',
  };
  return settings;
}

export function nativeLanguage() {
  return load('language.json');
}
