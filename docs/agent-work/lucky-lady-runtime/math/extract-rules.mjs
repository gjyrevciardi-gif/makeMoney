// Extracts the immutable Lucky Lady rules from the pinned ORIGINAL backend.
// Read-only: the external evidence tree is never written to.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = 'C:/Users/Admin/orca/research/game-pack-forensics/external/evidence/taxipult-goldsvet/casino/app/Games/LuckyLadysCharmDX';
const SERVER = join(SRC, 'Server.php');
const SETTINGS = join(SRC, 'SlotSettings.php');
const REELS = join(SRC, 'reels.txt');

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const read = (path) => readFileSync(path);

const settingsText = read(SETTINGS).toString('utf8');
const serverText = read(SERVER).toString('utf8');
const reelsText = read(REELS).toString('utf8');

// --- Paytable: literal assignments only, with the originating line number.
const paytable = {};
const paytableLines = {};
const paytableRe = /\$this->Paytable\['?([A-Za-z0-9_]+)'?\]\s*=\s*\[([^\]]*)\];/g;
let m;
while ((m = paytableRe.exec(settingsText)) !== null) {
  const name = m[1];
  const values = m[2].split(',').map((v) => parseInt(v.trim(), 10)).filter((v) => !Number.isNaN(v));
  paytable[name] = values;
  paytableLines[name] = settingsText.slice(0, m.index).split('\n').length;
}

// --- SymbolGame list and feature constants.
const symbolsMatch = settingsText.match(/\$this->SymbolGame\s*=\s*\[([^\]]*)\];/);
const symbols = symbolsMatch[1].split(',').map((s) => s.trim()).filter((s) => /^['"]/.test(s))
  .map((s) => s.replace(/^['"]|['"]$/g, ''));
const constNumber = (text, key) => {
  const hit = text.match(new RegExp('\\$this->' + key + '\\s*=\\s*(-?[0-9.]+)'));
  return hit ? Number(hit[1]) : null;
};
const constants = {
  slotWildMpl: constNumber(settingsText, 'slotWildMpl'),
  slotFreeMpl: constNumber(settingsText, 'slotFreeMpl'),
  slotFreeCount: constNumber(settingsText, 'slotFreeCount'),
  GambleType: constNumber(settingsText, 'GambleType'),
};
const wild = (serverText.match(/\$wild\s*=\s*\[([^\]]*)\];/) || [])[1].split(',')
  .map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const scatter = (serverText.match(/\$scatter\s*=\s*'([^']+)'/) || [])[1];

// --- Paylines: the linesId table from the original spin handler.
const linesBlock = serverText.match(/\(bet' \|\| \$postData\['slotEvent'\] == 'freespin' \)[\s\S]*?\$linesId\[9\] = \[([^\]]*)\];/);
const lines = [];
for (let k = 0; k < 10; k++) {
  const hit = serverText.match(new RegExp('\\$linesId\\[' + k + '\\] = \\[([^\\]]*)\\];'));
  if (!hit) throw new Error('missing line ' + k);
  lines.push(hit[1].split(',').map((v) => parseInt(v.trim(), 10)));
}

// --- Reel strips (uniform-stop baseline draws strip[stop..stop+2]).
const reels = {};
for (const line of reelsText.split(/\r?\n/)) {
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const key = line.slice(0, eq).trim();
  const values = line.slice(eq + 1).split(',').map((s) => s.trim()).filter(Boolean);
  if (/^reelStrip[1-9]$/.test(key) && values.length) reels[key] = values;
}

const provenance = {
  server: { path: SERVER, sha256: sha(read(SERVER)), bytes: read(SERVER).length },
  settings: { path: SETTINGS, sha256: sha(read(SETTINGS)), bytes: read(SETTINGS).length },
  reels: { path: REELS, sha256: sha(read(REELS)), bytes: read(REELS).length },
  paytableLines,
  linesBlockLine: linesBlock ? serverText.slice(0, linesBlock.index).split('\n').length : null,
};

const rules = {
  schema: 1,
  game: 'LuckyLadysCharmDX',
  evaluator: 'lucky-lady.original-evaluator.v1',
  stopsAreUniformOverStripMinusThree: true,
  visibleRows: 3,
  emptyRow: '',
  wild,
  scatter,
  symbols,
  paytable,
  lines,
  constants,
  reels,
  provenance,
};
mkdirSync(join(HERE, 'data'), { recursive: true });
writeFileSync(join(HERE, 'data', 'rules.json'), JSON.stringify(rules, null, 1) + '\n');
console.log(JSON.stringify({
  paytableSymbols: Object.keys(paytable).length,
  symbols: symbols.length,
  lines: lines.length,
  reels: Object.fromEntries(Object.entries(reels).map(([k, v]) => [k, v.length])),
  wild, scatter, constants,
  serverSha: provenance.server.sha256.slice(0, 16),
  settingsSha: provenance.settings.sha256.slice(0, 16),
  reelsSha: provenance.reels.sha256.slice(0, 16),
}, null, 1));