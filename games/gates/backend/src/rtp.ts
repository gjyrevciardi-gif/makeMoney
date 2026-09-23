import { cryptoRng } from './engine/rng.js';
import { playRound } from './engine/playRound.js';

const STAKE = 20;
const N = Number(process.argv[2] ?? 300000);

let staked = 0, baseRet = 0, freeRet = 0, triggers = 0, buyStaked = 0, buyRet = 0;
for (let i = 0; i < N; i++) {
  const r = playRound(cryptoRng, STAKE, 'rtp', false);
  staked += STAKE;
  for (const sp of r.spins) {
    if (sp.kind === 'BASE') baseRet += sp.spinWin; else freeRet += sp.spinWin;
  }
  if (r.freeSpins.triggered) triggers++;
}
const M = Math.floor(N / 40);
for (let i = 0; i < M; i++) {
  const r = playRound(cryptoRng, STAKE, 'rtp', true);
  buyStaked += STAKE * 100;
  buyRet += r.finalWin;
}
const pct = (a: number, b: number) => ((a / b) * 100).toFixed(2) + '%';
console.log(`spins=${N} stake=${STAKE}`);
console.log(`  base-game return : ${pct(baseRet, staked)}`);
console.log(`  free-spin return : ${pct(freeRet, staked)}`);
console.log(`  TOTAL RTP        : ${pct(baseRet + freeRet, staked)}`);
console.log(`  trigger rate     : 1 in ${(N / Math.max(triggers,1)).toFixed(0)}`);
console.log(`  BUY BONUS RTP    : ${pct(buyRet, buyStaked)}  (n=${M})`);
