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
export const SETTLEMENT_EVALUATORS: MarketSettlementEvaluator[] = [new H2HSettlementEvaluator(), new TotalsSettlementEvaluator(), new SpreadSettlementEvaluator()];
