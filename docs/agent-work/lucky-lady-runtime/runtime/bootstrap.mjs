// Repeatable bootstrap: copies the audited source-derived settings and translations into the
// external runtime directory. Read-only source, no invented configuration.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVerifiedMath } from './runtime-math.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/clean-runtime';
const PREVIEW = 'C:/Users/Admin/orca/research/game-pack-forensics/previews/LuckyLadysCharmDX';

mkdirSync(RUN, { recursive: true });
const source = JSON.parse(readFileSync(join(PREVIEW, 'getSettings.json'), 'utf8'));
writeFileSync(join(RUN, 'settings.json'), JSON.stringify(source.serverResponse, null, 1));
writeFileSync(join(RUN, 'language.json'), JSON.stringify(source.slotLanguage, null, 1));
const { profile, hashes } = loadVerifiedMath();
writeFileSync(join(RUN, 'config.json'), JSON.stringify({
  gameId: profile.game,
  rtpControlEnabled: true,
  targetRtpPercent: profile.targetRtpPercent,
  activeMathProfile: profile.id,
  profileHash: profile.canonicalHash,
  validatedLines: profile.validatedLines,
  evaluator: profile.evaluator,
  engineSha256: hashes.engineSha256,
  rulesSha256: hashes.rulesSha256,
  profileFileSha256: hashes.profileFileSha256,
}, null, 1) + '\n');
console.log(JSON.stringify({ bootstrapped: RUN, profileHash: profile.canonicalHash, engineSha256: hashes.engineSha256 }));