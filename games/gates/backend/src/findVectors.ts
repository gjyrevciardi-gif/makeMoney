/**
 * Search for seeds that reach each QA scenario, and report engine RTP.
 * Dev tool only - not part of the served API.
 */
import { seededRng, cryptoRng } from './engine/rng.js';
import { playRound } from './engine/playRound.js';

const STAKE = 20;

interface Found { [k: string]: number | undefined }
const found: Found = {};

function classify(seed: number): string[] {
  const tags: string[] = [];

  // base-game probe
  const base = playRound(seededRng(seed), STAKE, 'probe', false);
  const head = base.spins[0];
  const paySteps = head.steps.filter((s) => s.win > 0).length;

  if (base.finalWin === 0 && paySteps === 0) tags.push('loss');
  if (paySteps === 1 && !base.freeSpins.triggered) tags.push('win');
  if (paySteps >= 3 && !base.freeSpins.triggered) tags.push('multiTumble');
  if (base.freeSpins.triggered && base.kind === 'BASE') tags.push('freeSpins');

  // buy-bonus probe (same seed, feature entry)
  const buy = playRound(seededRng(seed), STAKE, 'probe', true);
  if (buy.spins.some((s) => s.orbs.length > 0 && s.appliedMultiplier > 1)) {
    tags.push('multiplier');
  }
  if (buy.freeSpins.retriggers > 0) tags.push('retrigger');
  if (buy.spins.length > 0) tags.push('buyBonus');

  return tags;
}

const WANT = ['loss', 'win', 'multiTumble', 'multiplier', 'freeSpins', 'retrigger', 'buyBonus'];

for (let seed = 1; seed < 400_000; seed++) {
  const tags = classify(seed);
  for (const t of tags) {
    if (found[t] === undefined) found[t] = seed;
  }
  if (WANT.every((w) => found[w] !== undefined)) break;
}

console.log('--- vector seeds ---');
for (const w of WANT) console.log(`  ${w.padEnd(13)} seed=${found[w] ?? 'NOT FOUND'}`);

// RTP sample on the production RNG
let staked = 0; let returned = 0; let triggers = 0;
const N = 200_000;
for (let i = 0; i < N; i++) {
  const r = playRound(cryptoRng, STAKE, 'rtp', false);
  staked += STAKE;
  returned += r.finalWin;
  if (r.freeSpins.triggered) triggers++;
}
console.log('--- base-game RTP sample ---');
console.log(`  spins=${N} staked=${staked} returned=${returned.toFixed(0)}`);
console.log(`  RTP=${((returned / staked) * 100).toFixed(2)}%  freeSpin trigger rate=1 in ${(N / Math.max(triggers, 1)).toFixed(0)}`);
