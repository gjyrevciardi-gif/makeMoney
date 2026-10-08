import { RULES, Spin } from './classic.engine';

/** Native BookOfRaCL projection; the evaluator remains independent of presentation. */
export function projectSpin(spin: Spin, lines: number, prior = 0) {
  const {board,evaluation:e}=spin;
  let running=prior;
  const entry=(line:number,count:number,amount:number,cells:number[][],symbol?:string)=>{
    running+=amount;
    return {Count:count,Line:line,Win:amount,stepWin:running,...Object.fromEntries(board.map((column,c)=>{
      const cell=cells.find(x=>x[0]===c);
      return [`winReel${c+1}`,cell?[cell[1],symbol??column[cell[1]]]:['none','none']];
    }))};
  };
  const winLines=e.lineWins.map(w=>entry(w.line,w.count,w.amount,w.cells));
  running+=e.scatterWin;
  const expLines=e.expansionWin?Array.from({length:lines},(_,line)=>entry(line,e.expandingReels.length,e.expansionWin/lines,e.expandingReels.map(c=>[c,RULES.paylines[line][c]]),spin.special!)):[];
  const bonusInfo={scattersType:e.trigger?'bonus':'none',scattersWin:e.scatterWin,...Object.fromEntries(board.flatMap((column,c)=>{const row=column.indexOf('SCAT');return row<0?[]:[[ `winReel${c+1}`,[row,'SCAT'] ]];}))};
  return {winLines,bonusInfo,expLines,expPay:e.expansionWin,expReels:[false,...board.map((_,c)=>e.expandingReels.includes(c))],...(spin.special?{expSymbol:spin.special}:{}),Jackpots:{},reelsSymbols:{...Object.fromEntries(board.map((column,c)=>[`reel${c+1}`,column])),rp:spin.stops}};
}
