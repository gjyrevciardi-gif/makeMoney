import { createHash, randomInt } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CLASSIC_ID = 'book-of-ra-classic';
export type Board = string[][];
export type Rules = { gameId: string; clientId: string; paylines: number[][]; paytable: Record<string, number[]>; strips: Record<string, string[]>; expandingSymbols: string[]; freeSpins: number; retriggerSpins: number };
const source = [join(__dirname,'math/rules.json'),join(process.cwd(),'backend/src/casino/games/book-of-ra-classic/math/rules.json'),join(process.cwd(),'src/casino/games/book-of-ra-classic/math/rules.json')].find(existsSync);
if (!source) throw Error('CLASSIC_RULES_MISSING');
const raw = readFileSync(source);
export const RULES: Rules = JSON.parse(raw.toString());
export const RULES_HASH = createHash('sha256').update(raw).digest('hex');
export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type IntRng = (upperExclusive: number) => number;
export const cryptoRng: IntRng = upper => randomInt(upper);
/** Simulation only. Runtime never selects this from a request or environment. */
export function simulationRng(seed: string): IntRng {
  let n = createHash('sha256').update(seed).digest().readUInt32LE(0) || 1;
  return upper => { n ^= n << 13; n ^= n >>> 17; n ^= n << 5; return Math.floor((n >>> 0) / 4294967296 * upper); };
}
export type LineWin = { line: number; symbol: string; count: number; amount: number; cells: number[][] };
export type Evaluation = { lineWins: LineWin[]; scatterCount: number; scatterWin: number; expandingReels: number[]; expansionWin: number; win: number; trigger: boolean };
function exact(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw Error('CLASSIC_MONEY_OVERFLOW'); return value; }
export function assertBet(bet: number, lines: number) {
  if (!Number.isSafeInteger(bet) || bet < 1 || !Number.isInteger(lines) || lines < 1 || lines > 9) throw Error('CLASSIC_INVALID_WAGER');
  exact(bet * lines);
}
/** Pure Classic rules. No wallet, history, RNG, profile selection or truncation. */
export function evaluate(board: Board, bet = 1, lines = 9, special: string | null = null): Evaluation {
  assertBet(bet,lines);
  if (board.length !== 5 || board.some(c=>c.length!==3 || c.some(s=>!RULES.paytable[s]))) throw Error('CLASSIC_INVALID_BOARD');
  if (special !== null && !RULES.expandingSymbols.includes(special)) throw Error('CLASSIC_INVALID_EXPANDING_SYMBOL');
  const lineWins: LineWin[] = [];
  for (let line=0;line<lines;line++) {
    const rows=RULES.paylines[line]; const values=rows.map((r,c)=>board[c][r]);
    let best: LineWin | null=null;
    for(const symbol of RULES.expandingSymbols){
      let count=0; while(count<5 && (values[count]===symbol || values[count]==='SCAT')) count++;
      const amount=bet*(RULES.paytable[symbol][count]||0);
      if(amount>0 && (!best || amount>best.amount)) best={line,symbol,count,amount,cells:rows.slice(0,count).map((r,c)=>[c,r])};
    }
    if(best) lineWins.push(best);
  }
  const scatterCount=board.flat().filter(s=>s==='SCAT').length;
  // Native strips have at most one Book in a 3-row reel window. Reject impossible inputs.
  if(board.some(c=>c.filter(s=>s==='SCAT').length>1)) throw Error('CLASSIC_MULTIPLE_BOOKS_ON_REEL');
  const scatterWin=bet*lines*(RULES.paytable.SCAT[scatterCount]||0);
  const expandingReels=special===null?[]:board.flatMap((c,i)=>c.includes(special)?[i]:[]);
  const expansionWin=special===null?0:bet*lines*(RULES.paytable[special][expandingReels.length]||0);
  return {lineWins,scatterCount,scatterWin,expandingReels:expansionWin?expandingReels:[],expansionWin,win:exact(lineWins.reduce((n,w)=>n+w.amount,0)+scatterWin+expansionWin),trigger:scatterCount>=3};
}
/** Reference strip windows, with the same non-wrapping stop domain as SlotSettings. */
export function boardAt(stops: number[]): Board {
  if(stops.length!==5) throw Error('CLASSIC_INVALID_STOPS');
  return stops.map((s,i)=>{const strip=RULES.strips[`reelStrip${i+1}`];if(!Number.isInteger(s)||s<0||s>strip.length-3)throw Error('CLASSIC_INVALID_STOP');return strip.slice(s,s+3);});
}
export type Support = { paidZero: number[][]; paidPositive: number[][]; positiveMass: number; free: Record<string,number[][]>; expectedRtpPercent: number; triggerProbability: number; retriggerProbability: number; featureReturn: number; maxPaid: number; maxFree: number };
export type ClassicProfile = { schema: 1; gameId: typeof CLASSIC_ID; targetRtpPercent: number; maxWinScope:'RESOLVED_SPIN'; maxWinMultiplier: number; mass: number; tables: Record<string,Support> };
const MASS=1_000_000_000;
/**
 * Hard bound on one round's free-spin chain.
 *
 * Every generated support table keeps `P(trigger) * freeSpins < 1`, so the
 * feature's expected length is finite and this bound is unreachable in practice;
 * it exists so a corrupted profile can only abort the round before settlement
 * rather than spin forever.
 */
export const FEATURE_SPIN_LIMIT = 20_000;
let candidates: number[][] | undefined;
function candidateStops() {
  if(candidates) return candidates;
  const rng=simulationRng('classic-reference-support-v1');
  candidates=Array.from({length:6000},()=>Array.from({length:5},(_,i)=>rng(RULES.strips[`reelStrip${i+1}`].length-2)));
  return candidates;
}
/** Offline support construction. Only pre-draw weights change; every candidate is a native strip window. */
export function generateProfile(targetRtpPercent=50,maxWinMultiplier=50): ClassicProfile {
  if(!Number.isFinite(targetRtpPercent)||targetRtpPercent<0||targetRtpPercent>100||!Number.isFinite(maxWinMultiplier)||maxWinMultiplier<18) throw Error('CLASSIC_UNSUPPORTED_POLICY');
  const all=candidateStops().map(stops=>({stops,board:boardAt(stops)}));
  const tables:Record<string,Support>={};
  for(let lines=1;lines<=9;lines++){
    const free:Record<string,number[][]>={}; let featureReturn=0;let retriggerProbability=0;let maxFree=0;
    for(const symbol of RULES.expandingSymbols){
      const allowed=all.map(x=>({...x,e:evaluate(x.board,1,lines,symbol)})).filter(x=>x.e.win<=maxWinMultiplier*lines).slice(0,192);
      if(!allowed.length) throw Error('CLASSIC_NO_FREE_SUPPORT');
      free[symbol]=allowed.map(x=>x.stops);
      const p=allowed.filter(x=>x.e.trigger).length/allowed.length;
      if(p*10>=1) throw Error('CLASSIC_DIVERGENT_FEATURE');
      featureReturn+=10*allowed.reduce((n,x)=>n+x.e.win,0)/allowed.length/(1-10*p)/9;
      retriggerProbability+=p/9;
      maxFree=Math.max(maxFree,...allowed.map(x=>x.e.win/lines));
    }
    const allowed=all.map(x=>({...x,e:evaluate(x.board,1,lines)})).filter(x=>x.e.win<=maxWinMultiplier*lines);
    const zero=allowed.filter(x=>x.e.win===0&&!x.e.trigger).slice(0,128);
    const positive=allowed.filter(x=>x.e.win>0||x.e.trigger).slice(0,256);
    if(!zero.length||!positive.length||!positive.some(x=>x.e.trigger))throw Error('CLASSIC_INCOMPLETE_SUPPORT');
    const highMean=positive.reduce((n,x)=>n+x.e.win+(x.e.trigger?featureReturn:0),0)/positive.length;
    const positiveMass=Math.round(targetRtpPercent/100*lines/highMean*MASS);
    if(positiveMass>MASS)throw Error('CLASSIC_TARGET_UNREACHABLE');
    const probability=positiveMass/MASS;
    tables[lines]={paidZero:zero.map(x=>x.stops),paidPositive:positive.map(x=>x.stops),positiveMass,free,expectedRtpPercent:probability*highMean/lines*100,triggerProbability:probability*positive.filter(x=>x.e.trigger).length/positive.length,retriggerProbability,featureReturn,maxPaid:Math.max(...positive.map(x=>x.e.win/lines)),maxFree};
  }
  return {schema:1,gameId:CLASSIC_ID,targetRtpPercent,maxWinScope:'RESOLVED_SPIN',maxWinMultiplier,mass:MASS,tables};
}
/** Recomputes all bounds and expectations independently from the stored candidate statistics. */
export function analyze(profile: ClassicProfile,lines=9){
  if(profile.gameId!==CLASSIC_ID||profile.schema!==1||profile.mass!==MASS||profile.maxWinScope!=='RESOLVED_SPIN')throw Error('CLASSIC_PROFILE_IDENTITY');
  const t=profile.tables[lines];if(!t||!Number.isSafeInteger(t.positiveMass)||t.positiveMass<0||t.positiveMass>MASS)throw Error('CLASSIC_PROFILE_MASS');
  let featureMean=0,freeMax=0,retrigger=0;
  for(const symbol of RULES.expandingSymbols){
    const es=t.free[symbol].map(s=>evaluate(boardAt(s),1,lines,symbol));
    if(!es.length)throw Error('CLASSIC_FREE_SUPPORT_EMPTY');
    const p=es.filter(e=>e.trigger).length/es.length;if(p*10>=1)throw Error('CLASSIC_DIVERGENT_FEATURE');
    featureMean+=10*es.reduce((n,e)=>n+e.win,0)/es.length/(1-10*p)/9;
    freeMax=Math.max(freeMax,...es.map(e=>e.win/lines));retrigger+=p/9;
  }
  const zero=t.paidZero.map(s=>evaluate(boardAt(s),1,lines));const pos=t.paidPositive.map(s=>evaluate(boardAt(s),1,lines));
  if(!zero.length||!pos.length||zero.some(e=>e.win||e.trigger))throw Error('CLASSIC_ZERO_SUPPORT');
  const p=t.positiveMass/MASS;
  const trigger=p*pos.filter(e=>e.trigger).length/pos.length;
  const base=p*pos.reduce((n,e)=>n+e.win,0)/pos.length;
  const paidMax=Math.max(...pos.map(e=>e.win/lines));
  if(Math.max(paidMax,freeMax)>profile.maxWinMultiplier)throw Error('CLASSIC_MAXWIN_SUPPORT');
  return {expectedRtpPercent:(base+trigger*featureMean)/lines*100,baseRtpPercent:base/lines*100,featureRtpPercent:trigger*featureMean/lines*100,triggerProbability:trigger,retriggerProbability:retrigger,paidMax,freeMax};
}
export type Spin = { stops:number[]; board:Board; evaluation:Evaluation; free:boolean; awarded:number; remaining:number; special:string|null };
export type CompleteRound = { spins:Spin[]; totalWin:number; featureWin:number; freeSpins:number; retriggers:number; special:string|null };
/** CSPRNG defaults. Features are fully prepared before settlement, with no runtime rejection sampling. */
export function playRound(profile:ClassicProfile,bet=1,lines=9,rng:IntRng=cryptoRng):CompleteRound {
  assertBet(bet,lines);const t=profile.tables[lines];if(!t)throw Error('CLASSIC_PROFILE_LINES');
  const paid=rng(profile.mass)<t.positiveMass?t.paidPositive:t.paidZero;
  let remaining=0,special:string|null=null,totalWin=0,featureWin=0,retriggers=0;
  const spins:Spin[]=[];
  do{
    const free=spins.length>0; const table=free?t.free[special!]:paid;
    const stops=table[rng(table.length)];const board=boardAt(stops);const evaluation=evaluate(board,bet,lines,free?special:null);
    if(evaluation.win>profile.maxWinMultiplier*bet*lines)throw Error('CLASSIC_MAXWIN_INVARIANT');
    if(free)remaining--;
    const awarded=evaluation.trigger?RULES.freeSpins:0;
    if(awarded){if(free)retriggers++;else special=RULES.expandingSymbols[rng(9)];remaining+=awarded;}
    totalWin=exact(totalWin+evaluation.win);if(free)featureWin=exact(featureWin+evaluation.win);
    spins.push({stops,board,evaluation,free,awarded,remaining,special});
    if(spins.length>=FEATURE_SPIN_LIMIT&&remaining>0)throw Error('CLASSIC_FEATURE_LIMIT_ABORT_NO_SETTLEMENT');
  }while(remaining>0);
  return {spins,totalWin,featureWin,freeSpins:spins.length-1,retriggers,special};
}
export function gamble(pending:number,choice:string,rng:IntRng=cryptoRng):{colour:'red'|'black';won:boolean;payout:number}{
  exact(pending);if(!pending||!['red','black'].includes(choice))throw Error('CLASSIC_INVALID_GAMBLE');
  const colour=rng(2)===0?'red':'black';return {colour,won:colour===choice,payout:colour===choice?exact(pending*2):0};
}
