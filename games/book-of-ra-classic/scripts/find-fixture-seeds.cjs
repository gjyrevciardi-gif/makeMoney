/*
 * Reproducible fixture-seed discovery for the Classic protocol tests.
 *
 * The integration spec hardcodes a handful of seeds and re-derives every
 * property from the accepted evaluator, so a drift in the engine or the frozen
 * profile fails loudly instead of silently reselecting a different outcome.
 * This script is how those seeds were found; it never fabricates a board.
 *
 * Usage (after `npm run build -w backend`):
 *   node games/book-of-ra-classic/scripts/find-fixture-seeds.cjs
 */
const path = require('node:path');
const { createSimulationRng } = require(path.join(
  __dirname, '..', '..', '..', 'backend', 'dist', 'src',
  'casino', 'platform', 'math-control', 'math-control.random.js',
));
const engine = require(path.join(
  __dirname, '..', '..', '..', 'backend', 'dist', 'src',
  'casino', 'games', 'book-of-ra-classic', 'classic.engine.js',
));
const math = require(path.join(
  __dirname, '..', '..', '..', 'backend', 'dist', 'src',
  'casino', 'games', 'book-of-ra-classic', 'classic.math-adapter.js',
));

const intRngFor = (seed) => {
  const rng = createSimulationRng(seed);
  return (upper) => rng.int(0, upper - 1);
};

const profile = math.defaultClassicProfile().payload;
const wanted = {
  ZERO: (round) => round.totalWin === 0 && round.freeSpins === 0,
  WIN: (round) => round.totalWin > 0 && round.freeSpins === 0,
  FEATURE: (round) => round.freeSpins === 10 && round.retriggers === 0,
  RETRIGGER: (round) => round.retriggers >= 1,
};
const found = {};
let scanned = 0;
for (let index = 0; index < 500_000 && Object.keys(found).length < Object.keys(wanted).length; index += 1) {
  const seed = `classic-${index}`;
  scanned += 1;
  const rng = intRngFor(seed);
  const round = engine.playRound(profile, 1, 9, rng);
  for (const [name, test] of Object.entries(wanted)) {
    if (!found[name] && test(round)) {
      found[name] = {
        seed,
        totalWin: round.totalWin,
        freeSpins: round.freeSpins,
        retriggers: round.retriggers,
        special: round.special,
        // The very next draw is the gamble colour the adapter would use.
        nextColour: rng(2) === 0 ? 'red' : 'black',
      };
    }
  }
}
process.stdout.write(`${JSON.stringify({ scanned, found }, null, 1)}\n`);
