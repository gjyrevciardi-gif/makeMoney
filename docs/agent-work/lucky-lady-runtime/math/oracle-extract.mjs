// Generates the external, test-only reference oracle from the PINNED ORIGINAL PHP.
// Nothing here is imported into the runtime; no original source enters Git.
// The generated PHP embeds verbatim source substrings and executes them with eval(),
// so the reference is the original arithmetic, not a re-implementation.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules } from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rules = loadRules();
const OUT_DIR = 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/math-oracle';
const OUT = join(OUT_DIR, 'lucky-lady-oracle.php');
const MANIFEST = join(HERE, 'runs', 'oracle-manifest.json');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

function verifiedSource(entry, label) {
  const raw = readFileSync(entry.path);
  const digest = sha256(raw);
  if (digest !== entry.sha256) {
    throw new Error(`${label} hash mismatch: expected ${entry.sha256}, found ${digest}`);
  }
  return raw.toString('utf8');
}

const server = verifiedSource(rules.provenance.server, 'Server.php');
const settings = verifiedSource(rules.provenance.settings, 'SlotSettings.php');
verifiedSource(rules.provenance.reels, 'reels.txt');

function extractBlock(text, start, end, from = 0) {
  const a = text.indexOf(start, from);
  if (a < 0) throw new Error(`start marker not found: ${start}`);
  const b = text.indexOf(end, a);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  const block = text.slice(a, b);
  let depth = 0;
  for (const ch of block) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth !== 0) throw new Error(`extracted block is unbalanced (depth ${depth}) from "${start}"`);
  return { block, start: a, end: b };
}

// Original per-line evaluation + scatter block (Server.php).
const evalExtract = extractBlock(server, "for( $k = 0; $k < $postData['slotLines']; $k++ )", 'if( $i > 1000 )');
const evalBlock = evalExtract.block;
// Original free-spin award / retrigger block, anchored AFTER the evaluation block so the
// earlier `$scattersCount >= 3` inside the scatter-string builder cannot match.
const awardExtract = extractBlock(server, 'if( $scattersCount >= 3 )',
  "$jsSpin = '' . json_encode($reels)", evalExtract.end);
const awardBlock = awardExtract.block;

const paytableMatch = /\$this->Paytable\['?([A-Za-z0-9_]+)'?\]\s*=\s*\[([^\]]*)\];/g;
const paytable = {};
let m;
while ((m = paytableMatch.exec(settings)) !== null) {
  paytable[m[1]] = m[2].split(',').map((v) => parseInt(v.trim(), 10)).filter((v) => !Number.isNaN(v));
}
const symMatch = settings.match(/\$this->SymbolGame\s*=\s*\[([^\]]*)\];/);
const symbols = symMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const num = (key) => {
  const hit = settings.match(new RegExp('\\$this->' + key + '\\s*=\\s*(-?[0-9.]+)'));
  if (!hit) throw new Error(`constant ${key} not found in source`);
  return Number(hit[1]);
};
const constants = { slotWildMpl: num('slotWildMpl'), slotFreeMpl: num('slotFreeMpl'), slotFreeCount: num('slotFreeCount') };
const lines = [];
for (let k = 0; k < 10; k++) {
  const hit = server.match(new RegExp('\\$linesId\\[' + k + '\\] = \\[([^\\]]*)\\];'));
  if (!hit) throw new Error(`linesId[${k}] not found`);
  lines.push(hit[1].split(',').map((v) => parseInt(v.trim(), 10)));
}

const phpArray = (value) => JSON.stringify(value).replace(/\[/g, '[').replace(/\]/g, ']');
const php = `<?php
ini_set('display_errors','stderr');
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);
// GENERATED reference oracle. Reproducible from Git via math/oracle-extract.mjs.
// It executes verbatim substrings of the pinned ORIGINAL PHP source.
$PAYTABLE = json_decode('${JSON.stringify(paytable).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', true);
$SYMBOLS = json_decode('${JSON.stringify(symbols)}', true);
$linesId = json_decode('${JSON.stringify(lines)}', true);
$WILD_MPL = ${constants.slotWildMpl};
$FREE_MPL = ${constants.slotFreeMpl};
$FREE_COUNT = ${constants.slotFreeCount};
$EVAL_BLOCK = <<<'PHPBLOCK'
${evalBlock}

PHPBLOCK;
$AWARD_BLOCK = <<<'PHPBLOCK'
${awardBlock}

PHPBLOCK;

class OracleSettings {
  public array $Paytable; public array $SymbolGame; public $slotWildMpl; public $slotFreeCount;
  private array $data = [];
  public array $writes = [];
  public function __construct($paytable,$symbols,$wildMpl,$freeCount){
    $this->Paytable=$paytable; $this->SymbolGame=$symbols; $this->slotWildMpl=$wildMpl; $this->slotFreeCount=$freeCount;
  }
  public function seed(string $key,$value){ $this->data[$key]=$value; }
  public function GetGameData($key){ return $this->data[$key] ?? 0; }
  public function SetGameData($key,$value){ $this->data[$key]=$value; $this->writes[$key]=$value; }
}

$input = json_decode(file_get_contents($argv[1]), true);
$settings = new OracleSettings($PAYTABLE,$SYMBOLS,$WILD_MPL,$FREE_COUNT);
$wild = ['P_1']; $scatter = 'SCAT';
$evaluated = [];
foreach ($input['vectors'] as $vector) {
  $reels = $vector['board'];
  $postData = ['slotLines' => $vector['lines'] ?? 10, 'slotBet' => $vector['bet'] ?? 1];
  $bonusMpl = $vector['isFree'] ? $FREE_MPL : 1;
  $totalWin = 0; $lineWins = []; $cWins = array_fill(0,10,0); $i = 0; $slotSettings = $settings;
  eval($EVAL_BLOCK);
  $evaluated[] = [
    'id' => $vector['id'],
    'lineWins' => array_values($lineWins),
    'baseWin' => $totalWin - $scattersWin,
    'scatterCount' => $scattersCount,
    'scatterWin' => $scattersWin,
    'totalWin' => $totalWin,
  ];
}
$features = [];
foreach ($input['features'] as $vector) {
  $scattersCount = $vector['scattersCount'];
  $totalWin = $vector['totalWin'];
  $Balance = $vector['balance'] ?? 0;
  $slotSettings = new OracleSettings($PAYTABLE,$SYMBOLS,$WILD_MPL,$FREE_COUNT);
  $slotSettings->seed('LuckyLadysCharmDXFreeGames', $vector['freeGamesBefore']);
  $slotSettings->seed('LuckyLadysCharmDXCurrentFreeGame', 0);
  $slotSettings->seed('LuckyLadysCharmDXBonusWin', 0);
  $slotSettings->seed('LuckyLadysCharmDXFreeBalance', 0);
  eval($AWARD_BLOCK);
  $features[] = [
    'id' => $vector['id'],
    'freeGamesAfter' => $slotSettings->GetGameData('LuckyLadysCharmDXFreeGames'),
    'bonusWinAfter' => $slotSettings->GetGameData('LuckyLadysCharmDXBonusWin'),
    'freeBalanceAfter' => $slotSettings->GetGameData('LuckyLadysCharmDXFreeBalance'),
  ];
}
echo json_encode([
  'sourceSha256' => ['server' => '${sha256(readFileSync(rules.provenance.server.path))}', 'settings' => '${sha256(readFileSync(rules.provenance.settings.path))}'],
  'constants' => ['slotWildMpl' => $WILD_MPL, 'slotFreeMpl' => $FREE_MPL, 'slotFreeCount' => $FREE_COUNT],
  'evalBlockChars' => strlen($EVAL_BLOCK),
  'awardBlockChars' => strlen($AWARD_BLOCK),
  'evaluated' => $evaluated,
  'features' => $features,
], JSON_PRETTY_PRINT);
`;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, php);
const manifest = {
  generated: new Date().toISOString(),
  oraclePath: OUT,
  oracleSha256: sha256(readFileSync(OUT)),
  sourceHashesVerified: {
    server: rules.provenance.server.sha256,
    settings: rules.provenance.settings.sha256,
    reels: rules.provenance.reels.sha256,
  },
  extractedBlocks: { evalBlockChars: evalBlock.length, awardBlockChars: awardBlock.length, evalBlockLine: server.slice(0, evalExtract.start).split('\n').length, awardBlockLine: server.slice(0, awardExtract.start).split('\n').length },
  constants,
};
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify(manifest, null, 1));