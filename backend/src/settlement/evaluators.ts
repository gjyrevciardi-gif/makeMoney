import { BetLeg, Prisma } from '@prisma/client';
import { NormalizedEventResult } from './result-provider';
export type Evaluation = 'WON' | 'LOST' | 'VOID' | 'UNRESOLVED';
export interface MarketSettlementEvaluator { supports(marketKey: string): boolean; evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation; }
const scores = (result: NormalizedEventResult) => result.homeScore === undefined || result.awayScore === undefined ? undefined : [new Prisma.Decimal(result.homeScore), new Prisma.Decimal(result.awayScore)] as const;
export class H2HSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'h2h'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { if (result.status === 'CANCELLED') return 'VOID'; if (result.status !== 'FINAL') return 'UNRESOLVED'; const value = scores(result); if (!value) return 'UNRESOLVED'; const winner = value[0].gt(value[1]) ? leg.homeTeam : value[1].gt(value[0]) ? leg.awayTeam : 'draw'; return leg.selectionName.toLowerCase() === winner.toLowerCase() ? 'WON' : 'LOST'; }
}
export class TotalsSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'totals'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { if (result.status === 'CANCELLED') return 'VOID'; if (result.status !== 'FINAL' || !leg.marketPoint) return 'UNRESOLVED'; const value = scores(result); if (!value) return 'UNRESOLVED'; const comparison = value[0].plus(value[1]).comparedTo(leg.marketPoint); if (comparison === 0) return 'VOID'; const over = leg.selectionName.toLowerCase().startsWith('over'); const under = leg.selectionName.toLowerCase().startsWith('under'); if (!over && !under) return 'UNRESOLVED'; return (over && comparison > 0) || (under && comparison < 0) ? 'WON' : 'LOST'; }
}
export class SpreadSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'spreads'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { if (result.status === 'CANCELLED') return 'VOID'; if (result.status !== 'FINAL' || !leg.marketPoint) return 'UNRESOLVED'; const value = scores(result); if (!value) return 'UNRESOLVED'; const selectedHome = leg.selectionName.toLowerCase() === leg.homeTeam.toLowerCase(), selectedAway = leg.selectionName.toLowerCase() === leg.awayTeam.toLowerCase(); if (!selectedHome && !selectedAway) return 'UNRESOLVED'; const selected = selectedHome ? value[0] : value[1], opponent = selectedHome ? value[1] : value[0]; const comparison = selected.plus(leg.marketPoint).comparedTo(opponent); return comparison === 0 ? 'VOID' : comparison > 0 ? 'WON' : 'LOST'; }
}
/**
 * The soccer markets below are decided by the same full-time pair the three
 * evaluators above use. Each reads `selectionKey`, not `selectionName`: keys are
 * normalized by the provider adapter, so a bookmaker relabelling "Home/Draw" to
 * "1X" cannot change how an already-stored bet settles.
 *
 * A market with no evaluator here is display-only, and `markets.ts` must mark it
 * `settleable: false`. `markets.spec.ts` fails the build if the two disagree.
 */
const outcome = (home: Prisma.Decimal, away: Prisma.Decimal) => home.gt(away) ? 'home' : away.gt(home) ? 'away' : 'draw';
/** Shared guard: settle only a finished event that carries both scores. */
const finalScores = (result: NormalizedEventResult) => result.status === 'CANCELLED' ? ('VOID' as const) : result.status !== 'FINAL' ? ('UNRESOLVED' as const) : (scores(result) ?? ('UNRESOLVED' as const));
export class DoubleChanceSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'double_chance'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { const value = finalScores(result); if (value === 'VOID' || value === 'UNRESOLVED') return value; const covered: Record<string, readonly string[]> = { home_draw: ['home', 'draw'], home_away: ['home', 'away'], draw_away: ['draw', 'away'] }; const wanted = covered[leg.selectionKey]; if (!wanted) return 'UNRESOLVED'; return wanted.includes(outcome(value[0], value[1])) ? 'WON' : 'LOST'; }
}
export class DrawNoBetSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'draw_no_bet'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { const value = finalScores(result); if (value === 'VOID' || value === 'UNRESOLVED') return value; if (leg.selectionKey !== 'home' && leg.selectionKey !== 'away') return 'UNRESOLVED'; const winner = outcome(value[0], value[1]); return winner === 'draw' ? 'VOID' : winner === leg.selectionKey ? 'WON' : 'LOST'; }
}
export class BttsSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'btts'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { const value = finalScores(result); if (value === 'VOID' || value === 'UNRESOLVED') return value; if (leg.selectionKey !== 'yes' && leg.selectionKey !== 'no') return 'UNRESOLVED'; const both = value[0].gt(0) && value[1].gt(0); return (leg.selectionKey === 'yes') === both ? 'WON' : 'LOST'; }
}
export class CorrectScoreSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'correct_score'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { const value = finalScores(result); if (value === 'VOID' || value === 'UNRESOLVED') return value; const match = /^(\d{1,2})-(\d{1,2})$/.exec(leg.selectionKey); if (!match) return 'UNRESOLVED'; return value[0].equals(new Prisma.Decimal(match[1])) && value[1].equals(new Prisma.Decimal(match[2])) ? 'WON' : 'LOST'; }
}
/**
 * Over/under selection keys carry their line ("over_2.5") so several lines of
 * one market stay distinguishable. Settlement still reads the line from
 * `marketPoint`, which is authoritative; the key only says which side was
 * taken. Bare "over"/"under" keys from before that change still resolve.
 */
const overUnderSide = (selectionKey: string): 'over' | 'under' | undefined => {
  const side = selectionKey.split('_')[0];
  return side === 'over' || side === 'under' ? side : undefined;
};
export class TeamTotalsSettlementEvaluator implements MarketSettlementEvaluator {
  supports(key: string) { return key === 'team_totals_home' || key === 'team_totals_away'; }
  evaluate(leg: BetLeg, result: NormalizedEventResult): Evaluation { const value = finalScores(result); if (value === 'VOID' || value === 'UNRESOLVED') return value; if (!leg.marketPoint) return 'UNRESOLVED'; const side = overUnderSide(leg.selectionKey); if (!side) return 'UNRESOLVED'; const scored = leg.marketKey === 'team_totals_home' ? value[0] : value[1]; const comparison = scored.comparedTo(leg.marketPoint); if (comparison === 0) return 'VOID'; return (side === 'over') === (comparison > 0) ? 'WON' : 'LOST'; }
}
export const SETTLEMENT_EVALUATORS: MarketSettlementEvaluator[] = [new H2HSettlementEvaluator(), new TotalsSettlementEvaluator(), new SpreadSettlementEvaluator(), new DoubleChanceSettlementEvaluator(), new DrawNoBetSettlementEvaluator(), new BttsSettlementEvaluator(), new CorrectScoreSettlementEvaluator(), new TeamTotalsSettlementEvaluator()];
