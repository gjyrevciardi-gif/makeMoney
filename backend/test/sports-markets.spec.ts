import { BetLeg, Prisma } from '@prisma/client';
import {
  BttsSettlementEvaluator,
  CorrectScoreSettlementEvaluator,
  DoubleChanceSettlementEvaluator,
  DrawNoBetSettlementEvaluator,
  SETTLEMENT_EVALUATORS,
  TeamTotalsSettlementEvaluator,
} from '../src/settlement/evaluators';
import { BETTABLE_MARKET_KEYS, MARKET_CATALOGUE, isBettableMarket, isDisplayableMarket } from '../src/sports/markets';

const leg = (data: Partial<BetLeg>) => ({ homeTeam: 'Home', awayTeam: 'Away', selectionName: 'Home', selectionKey: 'home', marketKey: 'h2h', marketPoint: null, ...data } as BetLeg);
const result = (homeScore: number, awayScore: number) => ({ provider: 'fixture', providerEventId: 'event', status: 'FINAL' as const, homeScore, awayScore });
const supported = (key: string) => SETTLEMENT_EVALUATORS.some(evaluator => evaluator.supports(key));

describe('market catalogue and settlement stay in agreement', () => {
  // The whole §5 guarantee rests on these two directions. If either drifts, a
  // market becomes stakeable with nothing able to settle it, or a settleable
  // market is silently refused.
  it('every market marked settleable has a real evaluator', () => {
    const missing = BETTABLE_MARKET_KEYS.filter(key => !supported(key));
    expect(missing).toEqual([]);
  });

  it('every market with an evaluator is marked settleable', () => {
    const undeclared = Object.keys(MARKET_CATALOGUE).filter(key => supported(key) && !MARKET_CATALOGUE[key].settleable);
    expect(undeclared).toEqual([]);
  });

  it('preserves the three pre-existing markets as bettable', () => {
    for (const key of ['h2h', 'spreads', 'totals']) expect(isBettableMarket(key)).toBe(true);
  });

  it('shows rich markets but refuses stakes on the ones nothing can settle', () => {
    for (const key of ['asian_handicap', 'ht_result', 'ht_totals', 'corners_totals', 'cards_totals']) {
      expect(isDisplayableMarket(key)).toBe(true);
      expect(isBettableMarket(key)).toBe(false);
      expect(MARKET_CATALOGUE[key].unsettleableReason).toBeTruthy();
    }
  });

  it('treats an unknown provider market as neither displayable nor bettable', () => {
    expect(isDisplayableMarket('provider_invented_market')).toBe(false);
    expect(isBettableMarket('provider_invented_market')).toBe(false);
  });
});

describe('soccer settlement evaluators', () => {
  it('settles double chance across all three covers', () => {
    const evaluator = new DoubleChanceSettlementEvaluator();
    expect(evaluator.evaluate(leg({ selectionKey: 'home_draw' }), result(2, 0))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: 'home_draw' }), result(1, 1))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: 'home_draw' }), result(0, 2))).toBe('LOST');
    expect(evaluator.evaluate(leg({ selectionKey: 'draw_away' }), result(0, 2))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: 'home_away' }), result(1, 1))).toBe('LOST');
  });

  it('voids draw no bet on a draw and settles it otherwise', () => {
    const evaluator = new DrawNoBetSettlementEvaluator();
    expect(evaluator.evaluate(leg({ selectionKey: 'home' }), result(2, 1))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: 'home' }), result(1, 2))).toBe('LOST');
    expect(evaluator.evaluate(leg({ selectionKey: 'home' }), result(1, 1))).toBe('VOID');
    expect(evaluator.evaluate(leg({ selectionKey: 'away' }), result(1, 1))).toBe('VOID');
  });

  it('settles both teams to score including nil-nil', () => {
    const evaluator = new BttsSettlementEvaluator();
    expect(evaluator.evaluate(leg({ selectionKey: 'yes' }), result(1, 1))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: 'yes' }), result(3, 0))).toBe('LOST');
    expect(evaluator.evaluate(leg({ selectionKey: 'no' }), result(3, 0))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: 'no' }), result(0, 0))).toBe('WON');
  });

  it('settles correct score exactly and never by reversed scoreline', () => {
    const evaluator = new CorrectScoreSettlementEvaluator();
    expect(evaluator.evaluate(leg({ selectionKey: '2-1' }), result(2, 1))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: '2-1' }), result(1, 2))).toBe('LOST');
    expect(evaluator.evaluate(leg({ selectionKey: '0-0' }), result(0, 0))).toBe('WON');
    expect(evaluator.evaluate(leg({ selectionKey: 'not-a-score' }), result(1, 0))).toBe('UNRESOLVED');
  });

  it('settles team totals against the correct team and voids exact pushes', () => {
    const evaluator = new TeamTotalsSettlementEvaluator();
    const home = (key: string, point: string) => leg({ marketKey: 'team_totals_home', selectionKey: key, marketPoint: new Prisma.Decimal(point) });
    const away = (key: string, point: string) => leg({ marketKey: 'team_totals_away', selectionKey: key, marketPoint: new Prisma.Decimal(point) });
    expect(evaluator.evaluate(home('over', '1.5'), result(2, 0))).toBe('WON');
    expect(evaluator.evaluate(home('under', '1.5'), result(2, 0))).toBe('LOST');
    // The away leg must read the away score, not the home one.
    expect(evaluator.evaluate(away('over', '1.5'), result(2, 0))).toBe('LOST');
    expect(evaluator.evaluate(away('over', '1.5'), result(0, 2))).toBe('WON');
    expect(evaluator.evaluate(home('over', '2'), result(2, 0))).toBe('VOID');
  });

  it('settles team totals whose key carries the line, and legacy bare keys', () => {
    // Keys became "over_1.5" so multiple lines stay distinct; settlement still
    // reads the line from marketPoint, and bets stored under the old bare key
    // must keep settling identically.
    const evaluator = new TeamTotalsSettlementEvaluator();
    const leg1 = leg({ marketKey: 'team_totals_home', selectionKey: 'over_1.5', marketPoint: new Prisma.Decimal('1.5') });
    const legacy = leg({ marketKey: 'team_totals_home', selectionKey: 'over', marketPoint: new Prisma.Decimal('1.5') });
    expect(evaluator.evaluate(leg1, result(2, 0))).toBe('WON');
    expect(evaluator.evaluate(legacy, result(2, 0))).toBe('WON');
    expect(evaluator.evaluate(leg({ marketKey: 'team_totals_away', selectionKey: 'under_1.5', marketPoint: new Prisma.Decimal('1.5') }), result(2, 0))).toBe('WON');
    expect(evaluator.evaluate(leg({ marketKey: 'team_totals_home', selectionKey: 'sideways_1.5', marketPoint: new Prisma.Decimal('1.5') }), result(2, 0))).toBe('UNRESOLVED');
  });

  it('leaves unfinished events unresolved and voids cancelled ones', () => {
    const pending = { provider: 'fixture', providerEventId: 'event', status: 'UNKNOWN' as const };
    const cancelled = { provider: 'fixture', providerEventId: 'event', status: 'CANCELLED' as const };
    for (const evaluator of [new DoubleChanceSettlementEvaluator(), new DrawNoBetSettlementEvaluator(), new BttsSettlementEvaluator(), new CorrectScoreSettlementEvaluator(), new TeamTotalsSettlementEvaluator()]) {
      expect(evaluator.evaluate(leg({ selectionKey: 'home_draw' }), pending)).toBe('UNRESOLVED');
      expect(evaluator.evaluate(leg({ selectionKey: 'home_draw' }), cancelled)).toBe('VOID');
    }
  });

  it('refuses to settle a selection key it does not recognise', () => {
    expect(new BttsSettlementEvaluator().evaluate(leg({ selectionKey: 'maybe' }), result(1, 1))).toBe('UNRESOLVED');
    expect(new DoubleChanceSettlementEvaluator().evaluate(leg({ selectionKey: 'anything' }), result(1, 1))).toBe('UNRESOLVED');
  });
});
