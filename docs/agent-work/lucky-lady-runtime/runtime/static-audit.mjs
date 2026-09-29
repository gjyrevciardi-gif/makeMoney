// Static audit of the ACTIVE production call graph, including the imported evaluator.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'runs', 'runtime-static-audit.json');
mkdirSync(dirname(OUT), { recursive: true });

const PRODUCTION = [
  { name: 'server.mjs', path: join(HERE, 'server.mjs') },
  { name: 'http-layer.mjs', path: join(HERE, 'http-layer.mjs') },
  { name: 'runtime-core.mjs', path: join(HERE, 'runtime-core.mjs') },
  { name: 'runtime-math.mjs', path: join(HERE, 'runtime-math.mjs') },
  { name: 'math/engine.mjs', path: join(HERE, '..', 'math', 'engine.mjs') },
  { name: 'harness/recovery-client.js', path: join(HERE, '..', 'harness', 'recovery-client.js') },
];

const FORBIDDEN = [
  { label: 'native Math.random', pattern: /Math\.random/ },
  { label: 'legacy rand/mt_rand/srand', pattern: /(?<![\w$.])(rand|mt_rand|srand|mt_srand)\s*\(/ },
  { label: 'legacy shuffle', pattern: /(?<![\w$.])shuffle\s*\(/ },
  { label: 'RTP feedback stat_in/stat_out', pattern: /\bstat_in\b|\bstat_out\b/ },
  { label: 'Percent targeting', pattern: /\bPercent\b|\.percent\b/ },
  { label: 'bank/cap suppression', pattern: /GetBank|SetBank|increaseRTP|SpinWinLimit|RtpControlCount|\bMaxWin\b|GetRandomPay/ },
  { label: 'PHP or PHP-process import', pattern: /\.php['"]|execFile\(.*php|spawn\(.*php/ },
  { label: 'outcome/profile override from request input', pattern: /body\.(profile|rng|seed|board|outcome)/ },
];

const missingFiles = [];
const findings = [];
const scanned = [];
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

for (const entry of PRODUCTION) {
  if (!existsSync(entry.path)) { missingFiles.push(entry.name); continue; }
  const text = stripComments(readFileSync(entry.path, 'utf8'));
  scanned.push({ name: entry.name, bytes: text.length });
  for (const rule of FORBIDDEN) {
    const match = text.match(rule.pattern);
    if (match) findings.push({ file: entry.name, rule: rule.label, sample: match[0] });
  }
}

// The production entry must not reference any test control.
const serverText = stripComments(readFileSync(join(HERE, 'server.mjs'), 'utf8'));
const productionTestReach = ['test-entry', 'createDeterministicRng', 'LUCKY_TEST', 'outcome', 'hooks', '__test/']
  .filter((needle) => serverText.includes(needle));
const testEntryText = readFileSync(join(HERE, 'test-entry.mjs'), 'utf8');
const testEntryUsesCore = /from '\.\/runtime-core\.mjs'/.test(testEntryText);

// Production must use the OS CSPRNG and never the deterministic generator.
const mathText = readFileSync(join(HERE, 'runtime-math.mjs'), 'utf8');
const usesCryptoRandomInt = /randomInt/.test(mathText);
const engineHasNoOsRng = !/randomInt|randomBytes/.test(readFileSync(join(HERE, '..', 'math', 'engine.mjs'), 'utf8'));

const result = {
  scanned,
  missingFiles,
  forbiddenFindings: findings,
  productionEntry: {
    usesOsCsprng: /createProductionRng/.test(serverText) && usesCryptoRandomInt,
    referencesTestControls: productionTestReach,
    cannotReachTestControls: productionTestReach.length === 0,
  },
  testEntry: { sharesCore: testEntryUsesCore, entry: 'test-entry.mjs (never imported by server.mjs)' },
  importedEngine: { scanned: 'math/engine.mjs', engineHasNoOsRng, engineHashPinnedInRuntimeMath: /PINNED_ENGINE_SHA256/.test(mathText) },
  archivedLegacyHarness: { path: 'harness/ (PHP pilot)', reachableFromRuntime: findings.some((f) => f.rule === 'PHP or PHP-process import') },
  pass: missingFiles.length === 0 && findings.length === 0 && productionTestReach.length === 0 && usesCryptoRandomInt && engineHasNoOsRng,
};
writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify({ pass: result.pass, findings, missingFiles, productionTestReach, scanned: scanned.map((s) => s.name) }, null, 1));
process.exitCode = result.pass ? 0 : 1;