// Reference comparison against the generated oracle (verbatim ORIGINAL blocks), plus
// exact feature/round accounting tests. Zero mismatches is required.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, createRng, evaluate, drawBoard, playRound, reelKeys, assertStake } from './engine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX';
const ORACLE = join(RUN, 'math-oracle', 'lucky-lady-oracle.php');
const PHP = 'C:/xampp/php/php.exe';
const rules = loadRules();
mkdirSync(join(HERE, 'runs'), { recursive: true });

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail: String(detail) });

const b = (r1, r2, r3, r4, r5) => ({
  reel1: [...r1, ''], reel2: [...r2, ''], reel3: [...r3, ''], reel4: [...r4, ''], reel5: [...r5, ''],
  rp: [0, 0, 0, 0, 0],
});

const noWin = b(['A', 'A', 'A'], ['K', 'K', 'K'], ['Q', 'J', '10'], ['J', '10', '9'], ['10', '9', 'Q']);
const line3 = b(['9', 'P_2', 'A'], ['Q', 'P_2', 'K'], ['10', 'P_2', 'Q'], ['J', 'A', 'K'], ['9', 'Q', '10']);
const leadingWild = b(['K', 'P_1', 'A'], ['Q', 'P_2', 'K'], ['10', 'P_2', 'Q'], ['J', 'A', 'K'], ['9', 'Q', '10']);
const allWild = b(['K', 'P_1', 'A'], ['Q', 'P_1', 'K'], ['10', 'P_1', 'Q'], ['J', 'P_1', 'K'], ['9', 'P_1', '10']);
const mixedWild = b(['K', 'P_1', 'A'], ['Q', 'P_1', 'K'], ['10', 'P_2', 'Q'], ['J', 'P_2', 'K'], ['9', 'Q', '10']);
const scatter2 = b(['K', 'SCAT', 'A'], ['Q', 'A', 'K'], ['10', 'SCAT', 'Q'], ['J', 'A', 'K'], ['9', 'Q', '10']);
const scatter3 = b(['K', 'SCAT', 'A'], ['Q', 'SCAT', 'K'], ['10', 'SCAT', 'Q'], ['J', 'A', 'K'], ['9', 'Q', '10']);
const scatter4 = b(['K', 'SCAT', 'A'], ['Q', 'SCAT', 'K'], ['10', 'SCAT', 'Q'], ['J', 'SCAT', 'K'], ['9', 'Q', '10']);
const scatter5 = b(['K', 'SCAT', 'A'], ['Q', 'SCAT', 'K'], ['10', 'SCAT', 'Q'], ['J', 'SCAT', 'K'], ['9', 'SCAT', '10']);
const multiLine = b(['P_2', 'P_3', 'P_4'], ['P_2', 'P_3', 'P_4'], ['P_2', 'P_3', 'P_4'], ['P_2', 'P_3', 'P_4'], ['P_2', 'P_3', 'P_4']);

const vectors = [
  { id: 'no-win', board: noWin, bet: 1, lines: 10, isFree: false },
  { id: 'ordinary-3-of-a-kind', board: line3, bet: 1, lines: 10, isFree: false },
  { id: 'leading-wild', board: leadingWild, bet: 1, lines: 10, isFree: false },
  { id: 'all-wild-line', board: allWild, bet: 1, lines: 10, isFree: false },
  { id: 'mixed-wilds', board: mixedWild, bet: 1, lines: 10, isFree: false },
  { id: 'scatter-2', board: scatter2, bet: 1, lines: 10, isFree: false },
  { id: 'scatter-3-trigger', board: scatter3, bet: 1, lines: 10, isFree: false },
  { id: 'scatter-4', board: scatter4, bet: 1, lines: 10, isFree: false },
  { id: 'scatter-5', board: scatter5, bet: 1, lines: 10, isFree: false },
  { id: 'multiline', board: multiLine, bet: 1, lines: 10, isFree: false },
  { id: 'line3-1-line-enabled', board: line3, bet: 1, lines: 1, isFree: false },
  { id: 'free-multiplier', board: line3, bet: 1, lines: 10, isFree: true },
  { id: 'free-multiplier-5-lines', board: multiLine, bet: 1, lines: 5, isFree: true },
  { id: 'bet-3-stake', board: line3, bet: 3, lines: 10, isFree: false },
];
const randomRng = createRng('vectors-random');
for (let i = 0; i < 500; i++) {
  vectors.push({ id: `random-${i}`, board: drawBoard(rules, null, randomRng), bet: 1, lines: 10, isFree: i % 4 === 0 });
}

// Feature-award vectors exercise the ORIGINAL award/retrigger block (Server.php 648-662).
const features = [
  { id: 'award-first-trigger', freeGamesBefore: 0, scattersCount: 3, totalWin: 50, balance: 100 },
  { id: 'award-retrigger', freeGamesBefore: 15, scattersCount: 3, totalWin: 120, balance: 100 },
  { id: 'award-two-below-three', freeGamesBefore: 0, scattersCount: 2, totalWin: 10, balance: 100 },
  { id: 'award-five-scatters-retrigger', freeGamesBefore: 30, scattersCount: 5, totalWin: 900, balance: 100 },
];

const oracleInput = join(HERE, 'runs', 'oracle-input.json');
writeFileSync(oracleInput, JSON.stringify({
  vectors: vectors.map((v) => ({ id: v.id, board: v.board, lines: v.lines, bet: v.bet, isFree: v.isFree })),
  features,
}));
const oracle = JSON.parse(execFileSync(PHP, [ORACLE, oracleInput], { encoding: 'utf8' }));

// --- Board evaluation: exact per-line ids and amounts, not just totals.
const mismatches = [];
const edgeRows = [];
for (let i = 0; i < vectors.length; i++) {
  const v = vectors[i];
  const expected = oracle.evaluated[i];
  const actual = evaluate(rules, v.board, { bet: v.bet, lines: v.lines, isFree: v.isFree });
  const expLines = expected.lineWins.map((s) => JSON.parse(s)).map((o) => ({ line: o.Line, win: o.Win }));
  const actLines = actual.lineWins.map((l) => ({ line: l.line, win: l.win }));
  const same = JSON.stringify(expLines) === JSON.stringify(actLines)
    && actual.baseWin === expected.baseWin
    && actual.scatterCount === expected.scatterCount
    && actual.scatterWin === expected.scatterWin
    && actual.totalWin === expected.totalWin;
  if (!same) mismatches.push({ id: v.id, engine: actLines, oracle: expLines, engineTotal: actual.totalWin, oracleTotal: expected.totalWin });
  if (i < 14) edgeRows.push({ id: v.id, lines: actLines, scatterCount: actual.scatterCount, scatterWin: actual.scatterWin, total: actual.totalWin });
}
check('reference.all-vectors-match-original-line-by-line', mismatches.length === 0, `${vectors.length} vectors, ${mismatches.length} mismatches`);

// --- Feature award / retrigger rule vs the original block.
const awardRows = [];
for (let i = 0; i < features.length; i++) {
  const f = features[i];
  const expected = oracle.features[i].freeGamesAfter;
  const engineAward = f.scattersCount >= 3
    ? (f.freeGamesBefore > 0 ? f.freeGamesBefore + rules.constants.slotFreeCount : rules.constants.slotFreeCount)
    : f.freeGamesBefore;
  awardRows.push({ id: f.id, freeGamesBefore: f.freeGamesBefore, scattersCount: f.scattersCount, engineFreeGamesAfter: engineAward, oracleFreeGamesAfter: expected });
  check(`feature.award-rule-matches-original.${f.id}`, engineAward === expected, `${engineAward} vs ${expected}`);
}
check('feature.award-uses-source-free-count', rules.constants.slotFreeCount === oracle.constants.slotFreeCount && rules.constants.slotFreeMpl === oracle.constants.slotFreeMpl,
  `freeCount=${rules.constants.slotFreeCount} freeMpl=${rules.constants.slotFreeMpl}`);

// --- Exact feature-round behaviour with strictly in-range scripted draws.
function stopWithScatter(strip) {
  for (let i = 0; i <= strip.length - 3; i++) {
    const window = strip.slice(i, i + 3);
    if (window.filter((s) => s === rules.scatter).length === 1) return i;
  }
  throw new Error('no single-scatter window found');
}
function stopWithoutScatter(strip) {
  for (let i = 0; i <= strip.length - 3; i++) {
    if (!strip.slice(i, i + 3).includes(rules.scatter)) return i;
  }
  throw new Error('no scatter-free window found');
}
const keys = reelKeys(rules);
const scatterStops = keys.map((k) => stopWithScatter(rules.reels[k]));
const safeStops = keys.map((k) => stopWithoutScatter(rules.reels[k]));
const triggerBoard = [scatterStops[0], scatterStops[1], scatterStops[2], safeStops[3], safeStops[4]];
const safeBoard = safeStops.slice();
const retriggerBoard = triggerBoard.slice();

function scriptedBoards(boards) {
  const flat = boards.flat().map((stop) => stop + 1); // weights are uniform: rng.int(1, stops) is 1-based
  let index = 0;
  let draws = 0;
  return {
    rng: {
      int(min, max) {
        if (index >= flat.length) throw new Error('scripted RNG exhausted');
        const value = flat[index++];
        draws++;
        if (value < min || value > max) throw new Error(`scripted draw ${value} outside ${min}..${max}`);
        return value;
      },
    },
    draws: () => draws,
  };
}

// exact 15: one trigger, then 15 scatter-free free spins (no retrigger)
const exact15 = scriptedBoards([triggerBoard, ...Array(15).fill(safeBoard)]);
const round15 = playRound(rules, null, { bet: 1, lines: 10, rng: exact15.rng, capture: true });
check('feature.exact-15-free-spins', round15.feature.spins === 15 && round15.feature.awarded === 15, `spins=${round15.feature.spins} awarded=${round15.feature.awarded}`);
check('feature.exact-15-no-retrigger', round15.feature.retriggers === 0, `retriggers=${round15.feature.retriggers}`);
check('feature.exact-15-draw-count', exact15.draws() === 5 * (1 + 15), `draws=${exact15.draws()} expected=${5 * (1 + 15)}`);
check('feature.exact-15-sequence-length', round15.feature.sequence.length === 15);

// exact 30: trigger, then one retrigger, then 29 scatter-free free spins
const exact30 = scriptedBoards([triggerBoard, retriggerBoard, ...Array(29).fill(safeBoard)]);
const round30 = playRound(rules, null, { bet: 1, lines: 10, rng: exact30.rng, capture: true });
check('feature.exact-30-one-retrigger', round30.feature.spins === 30 && round30.feature.retriggers === 1, `spins=${round30.feature.spins} retriggers=${round30.feature.retriggers}`);
check('feature.exact-30-draw-count', exact30.draws() === 5 * (1 + 30), `draws=${exact30.draws()} expected=${5 * (1 + 30)}`);
check('feature.retrigger-flag-on-sequence', round30.feature.sequence[0].retriggered === true && round30.feature.sequence[1].retriggered === false);
check('feature.remaining-after-retrigger', round30.feature.sequence[0].remainingAfter === 29, `remaining=${round30.feature.sequence[0].remainingAfter}`);

// cumulative payouts across the captured sequence
let running = 0;
let cumulativeOk = true;
for (const spin of round30.feature.sequence) {
  running += spin.spinWin;
  if (spin.cumulativeFeatureWin !== running) cumulativeOk = false;
}
check('feature.cumulative-payouts-consistent', cumulativeOk && Math.abs(round30.feature.win - running) < 1e-9,
  `featureWin=${round30.feature.win} replay=${running}`);
check('feature.multiplier-from-source', round30.feature.multiplier === rules.constants.slotFreeMpl,
  `multiplier=${round30.feature.multiplier}`);

// --- RNG / input validation and purity.
let drawsForPlainRound = 0;
const base = createRng('count-base');
const counting = { int: (min, max) => { drawsForPlainRound++; return base.int(min, max); } };
playRound(rules, null, { bet: 1, lines: 10, rng: counting });
check('generator.one-stop-draw-per-reel-per-spin', drawsForPlainRound === 5, `draws=${drawsForPlainRound}`);

const seq = (seed) => { const r = createRng(seed); return [0, 1, 2].map(() => drawBoard(rules, null, r).rp.join(',')); };
check('rng.deterministic-repeatable', JSON.stringify(seq('det')) === JSON.stringify(seq('det')));
check('rng.seed-sensitive', JSON.stringify(seq('det')) !== JSON.stringify(seq('det2')));

const expectThrow = (name, fn) => { try { fn(); check(name, false, 'no error thrown'); } catch { check(name, true); } };
expectThrow('rng.rejects-span-over-32bit', () => createRng('x').int(0, 2 ** 33));
expectThrow('rng.rejects-fractional-bounds', () => createRng('x').int(0, 3.5));
expectThrow('rng.rejects-inverted-range', () => createRng('x').int(7, 3));
expectThrow('engine.rejects-zero-bet', () => playRound(rules, null, { bet: 0, lines: 10, rng: createRng('x') }));
expectThrow('engine.rejects-lines-over-ten', () => playRound(rules, null, { bet: 1, lines: 11, rng: createRng('x') }));
expectThrow('engine.rejects-fractional-stake', () => assertStake(1.5, 10));
expectThrow('engine.rejects-out-of-range-injected-rng', () => playRound(rules, null, { bet: 1, lines: 10, rng: { int: () => 0 } }));
expectThrow('profile.rejects-all-zero-weights', () => drawBoard(rules, { stopWeights: { reelStrip1: new Array(rules.reels.reelStrip1.length - 2).fill(0) } }, createRng('x')));
expectThrow('profile.rejects-fractional-weights', () => drawBoard(rules, { stopWeights: { reelStrip1: new Array(rules.reels.reelStrip1.length - 2).fill(1.5) } }, createRng('x')));
expectThrow('profile.rejects-wrong-weight-length', () => drawBoard(rules, { stopWeights: { reelStrip1: [1, 2, 3] } }, createRng('x')));

const report = {
  oracleSourceSha256: oracle.sourceSha256,
  oracleConstants: oracle.constants,
  rulesProvenance: rules.provenance,
  vectors: vectors.length,
  mismatches,
  edgeRows,
  awardRows,
  featureRounds: {
    exact15: { spins: round15.feature.spins, retriggers: round15.feature.retriggers, draws: exact15.draws(), win: round15.feature.win, totalWin: round15.totalWin },
    exact30: { spins: round30.feature.spins, retriggers: round30.feature.retriggers, draws: exact30.draws(), win: round30.feature.win, totalWin: round30.totalWin },
  },
  checks,
};
writeFileSync(join(HERE, 'runs', 'vectors.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({
  vectors: vectors.length,
  mismatches: mismatches.length,
  failedChecks: checks.filter((c) => !c.ok).map((c) => c.name),
  awardRows,
  feature: report.featureRounds,
}, null, 1));
if (mismatches.length || checks.some((c) => !c.ok)) process.exitCode = 1;