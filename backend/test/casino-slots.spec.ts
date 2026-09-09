import { FairnessInput } from '../src/casino/casino-fairness.service';
import {
  FOOLS_GOLD_RUSH_V1,
  SlotDefinitionError,
  findSlotDefinition,
  slotDefinitions,
  slotVersion,
  validateSlotDefinition,
} from '../src/casino/games/slots/slot.definitions';
import {
  buildMatrix,
  combineReturn,
  deriveStops,
  evaluateLine,
  evaluateLines,
  evaluateScatter,
  resolveSpin,
  resolveStops,
  slotPayout,
  symbolIndex,
} from '../src/casino/games/slots/slot.engine';
import {
  analyseSlotRtp,
  enumerateSlot,
  maxPossibleReturnNumerator,
} from '../src/casino/games/slots/slot.rtp';
import { SlotGameDefinition } from '../src/casino/games/slots/slot.types';

/**
 * Pure slot tests. No Nest, no database, no HTTP.
 *
 * The theoretical RTP here is computed exactly, twice, by two independent
 * methods. Nothing is sampled and no statistical claim is made.
 */
describe('slot engine and mathematics', () => {
  const game = FOOLS_GOLD_RUSH_V1;
  const fairness = (overrides: Partial<FairnessInput> = {}): FairnessInput => ({
    serverSeed: 'e'.repeat(64),
    domain: 'casino:test:v1',
    clientSeed: 'client',
    nonce: 0,
    ...overrides,
  });

  /** A tiny hand-built game used to test the evaluator in isolation. */
  const fixture = (overrides: Partial<SlotGameDefinition> = {}): SlotGameDefinition => ({
    gameId: 'fixture-game',
    name: 'Fixture',
    description: 'test fixture',
    mathVersion: 1,
    reels: 5,
    rows: 3,
    symbols: [
      { id: 'HI', name: 'High', type: 'NORMAL' },
      { id: 'LO', name: 'Low', type: 'NORMAL' },
      { id: 'WILD', name: 'Wild', type: 'WILD' },
      { id: 'SCAT', name: 'Scatter', type: 'SCATTER' },
    ],
    strips: [
      ['HI', 'LO', 'WILD', 'SCAT'],
      ['HI', 'LO', 'WILD', 'SCAT'],
      ['HI', 'LO', 'WILD', 'SCAT'],
      ['HI', 'LO', 'WILD', 'SCAT'],
      ['HI', 'LO', 'WILD', 'SCAT'],
    ],
    paylines: [{ id: 1, rows: [0, 0, 0, 0, 0] }],
    paytable: {
      HI: { 3: 1_000, 4: 5_000, 5: 20_000 },
      LO: { 3: 500, 4: 2_000, 5: 8_000 },
    },
    scatter: { symbolId: 'SCAT', minimumCount: 3, tiers: { 3: 100, 4: 500, 5: 2_500 } },
    maxWinCenti: 1_000_000,
    volatility: 'MEDIUM',
    declaredRtpBps: 9_000,
    ...overrides,
  });

  const evaluate = (definition: SlotGameDefinition, lineSymbols: string[]) =>
    evaluateLine(definition, symbolIndex(definition), lineSymbols);

  describe('reel stops and the visible matrix', () => {
    it('draws one in-range stop per reel', () => {
      const stops = deriveStops(fairness(), game);
      expect(stops).toHaveLength(game.reels);
      stops.forEach((stop, reel) => {
        expect(Number.isInteger(stop)).toBe(true);
        expect(stop).toBeGreaterThanOrEqual(0);
        expect(stop).toBeLessThan(game.strips[reel].length);
      });
    });

    it('gives each reel its own draw against its own strip length', () => {
      // Unequal strip lengths would expose a shared or reused draw.
      const uneven = fixture({
        strips: [
          ['HI', 'LO'],
          ['HI', 'LO', 'WILD'],
          ['HI', 'LO', 'WILD', 'SCAT'],
          ['HI', 'LO', 'WILD', 'SCAT', 'HI'],
          ['HI', 'LO', 'WILD', 'SCAT', 'HI', 'LO'],
        ],
      });
      for (let nonce = 0; nonce < 80; nonce += 1) {
        deriveStops(fairness({ nonce }), uneven).forEach((stop, reel) => {
          expect(stop).toBeGreaterThanOrEqual(0);
          expect(stop).toBeLessThan(uneven.strips[reel].length);
        });
      }
    });

    it('reproduces the identical stops from identical fairness inputs', () => {
      expect(deriveStops(fairness(), game)).toEqual(deriveStops(fairness(), game));
      expect(deriveStops(fairness(), game))
        .not.toEqual(deriveStops(fairness({ nonce: 1 }), game));
      expect(deriveStops(fairness({ domain: 'a' }), game))
        .not.toEqual(deriveStops(fairness({ domain: 'b' }), game));
    });

    it('reads the visible window with wrap-around', () => {
      const definition = fixture();
      // Stop 3 on a 4-long strip wraps to indices 3, 0, 1.
      const matrix = buildMatrix(definition, [3, 0, 0, 0, 0]);
      expect(matrix[0][0]).toBe('SCAT');
      expect(matrix[1][0]).toBe('HI');
      expect(matrix[2][0]).toBe('LO');
    });

    it('orients the matrix as matrix[row][reel]', () => {
      const definition = fixture({
        strips: [
          ['A0', 'A1', 'A2'], ['B0', 'B1', 'B2'], ['C0', 'C1', 'C2'],
          ['D0', 'D1', 'D2'], ['E0', 'E1', 'E2'],
        ],
        symbols: ['A', 'B', 'C', 'D', 'E'].flatMap((reel) =>
          [0, 1, 2].map((row) => ({ id: `${reel}${row}`, name: `${reel}${row}`, type: 'NORMAL' as const }))),
        paytable: {},
        scatter: null,
      });
      const matrix = buildMatrix(definition, [0, 0, 0, 0, 0]);
      expect(matrix).toHaveLength(3);
      expect(matrix[0]).toHaveLength(5);
      // Row 1 across all five reels, not reel 1 down all rows.
      expect(matrix[1]).toEqual(['A1', 'B1', 'C1', 'D1', 'E1']);
      expect(matrix.map((row) => row[2])).toEqual(['C0', 'C1', 'C2']);
    });

    it('rejects a stop outside its strip', () => {
      expect(() => buildMatrix(fixture(), [4, 0, 0, 0, 0])).toThrow(RangeError);
      expect(() => buildMatrix(fixture(), [-1, 0, 0, 0, 0])).toThrow(RangeError);
      expect(() => buildMatrix(fixture(), [0, 0, 0])).toThrow(RangeError);
    });
  });

  describe('payline evaluation', () => {
    const definition = fixture();

    it('pays nothing without three from the left', () => {
      // Two HI then a break: the run stops at two, below the three minimum.
      expect(evaluate(definition, ['HI', 'HI', 'LO', 'HI', 'HI'])).toBeNull();
      // A single leading LO cannot reach three either, and the trailing HI run
      // does not count because it does not start on reel one.
      expect(evaluate(definition, ['LO', 'HI', 'HI', 'HI', 'HI'])).toBeNull();
    });

    it('requires the win to start on reel one', () => {
      // Four HI, but the run does not begin on the first reel.
      expect(evaluate(definition, ['SCAT', 'HI', 'HI', 'HI', 'HI'])).toBeNull();
      expect(evaluate(definition, ['HI', 'HI', 'HI', 'SCAT', 'HI'])?.count).toBe(3);
    });

    it.each([
      [['HI', 'HI', 'HI', 'LO', 'LO'], 3, 1_000],
      [['HI', 'HI', 'HI', 'HI', 'LO'], 4, 5_000],
      [['HI', 'HI', 'HI', 'HI', 'HI'], 5, 20_000],
    ])('pays %j as %i of a kind', (line, count, multiplier) => {
      const win = evaluate(definition, line as string[]);
      expect(win?.symbolId).toBe('HI');
      expect(win?.count).toBe(count);
      expect(win?.multiplierCenti).toBe(multiplier);
    });

    it('substitutes wild for a paying symbol', () => {
      const win = evaluate(definition, ['HI', 'HI', 'WILD', 'HI', 'LO']);
      expect(win?.symbolId).toBe('HI');
      expect(win?.count).toBe(4);
      expect(win?.multiplierCenti).toBe(5_000);
    });

    it('never substitutes wild for scatter', () => {
      const scatterLine = ['WILD', 'WILD', 'WILD', 'SCAT', 'SCAT'];
      const win = evaluate(definition, scatterLine);
      // Wilds still pay as the best normal symbol, but the scatters do not extend it.
      expect(win?.symbolId).toBe('HI');
      expect(win?.count).toBe(3);
      expect(evaluate(definition, ['SCAT', 'SCAT', 'SCAT', 'SCAT', 'SCAT'])).toBeNull();
    });

    it('resolves a leading wild to the best-paying interpretation deterministically', () => {
      // WILD WILD LO ... could be read as HI(2, no pay) or LO(3). LO pays.
      expect(evaluate(definition, ['WILD', 'WILD', 'LO', 'HI', 'HI'])?.symbolId).toBe('LO');
      // An all-wild line pays the highest symbol, five of a kind.
      const allWild = evaluate(definition, ['WILD', 'WILD', 'WILD', 'WILD', 'WILD']);
      expect(allWild?.symbolId).toBe('HI');
      expect(allWild?.count).toBe(5);
      expect(allWild?.multiplierCenti).toBe(20_000);
      // Repeated evaluation is stable.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect(evaluate(definition, ['WILD', 'WILD', 'WILD', 'WILD', 'WILD'])?.symbolId).toBe('HI');
      }
    });

    it('breaks a tie on the declared symbol order', () => {
      const tied = fixture({
        paytable: { HI: { 3: 500, 4: 500, 5: 500 }, LO: { 3: 500, 4: 500, 5: 500 } },
      });
      // Both readings pay 500; the earlier declared symbol wins.
      expect(evaluate(tied, ['WILD', 'WILD', 'WILD', 'LO', 'LO'])?.symbolId).toBe('HI');
    });

    it('counts several winning lines once each', () => {
      const multi = fixture({
        paylines: [
          { id: 1, rows: [0, 0, 0, 0, 0] },
          { id: 2, rows: [1, 1, 1, 1, 1] },
          { id: 3, rows: [2, 2, 2, 2, 2] },
        ],
      });
      const matrix = [
        ['HI', 'HI', 'HI', 'LO', 'LO'],
        ['LO', 'LO', 'LO', 'HI', 'HI'],
        ['SCAT', 'HI', 'HI', 'HI', 'HI'],
      ];
      const wins = evaluateLines(multi, matrix);
      expect(wins.map((win) => win.lineId)).toEqual([1, 2]);
      expect(new Set(wins.map((win) => win.lineId)).size).toBe(wins.length);
      expect(wins[0].positions).toEqual([[0, 0], [0, 1], [0, 2]]);
    });
  });

  describe('scatter', () => {
    const definition = fixture();

    it('pays on total count anywhere, independently of paylines', () => {
      const matrix = [
        ['SCAT', 'HI', 'SCAT', 'HI', 'HI'],
        ['HI', 'SCAT', 'HI', 'HI', 'HI'],
        ['HI', 'HI', 'HI', 'HI', 'HI'],
      ];
      const win = evaluateScatter(definition, matrix);
      expect(win?.count).toBe(3);
      expect(win?.multiplierCenti).toBe(100);
      expect(win?.positions).toHaveLength(3);
    });

    it('pays nothing below the minimum and uses the highest applicable tier', () => {
      const two = [
        ['SCAT', 'SCAT', 'HI', 'HI', 'HI'],
        ['HI', 'HI', 'HI', 'HI', 'HI'],
        ['HI', 'HI', 'HI', 'HI', 'HI'],
      ];
      expect(evaluateScatter(definition, two)).toBeNull();
      const six = [
        ['SCAT', 'SCAT', 'SCAT', 'SCAT', 'SCAT'],
        ['SCAT', 'HI', 'HI', 'HI', 'HI'],
        ['HI', 'HI', 'HI', 'HI', 'HI'],
      ];
      expect(evaluateScatter(definition, six)?.multiplierCenti).toBe(2_500);
    });

    it('is absent when the definition declares no scatter', () => {
      expect(evaluateScatter(fixture({ scatter: null }), [
        ['SCAT', 'SCAT', 'SCAT', 'SCAT', 'SCAT'],
        ['HI', 'HI', 'HI', 'HI', 'HI'],
        ['HI', 'HI', 'HI', 'HI', 'HI'],
      ])).toBeNull();
    });
  });

  describe('return combination and payout', () => {
    it('sums line multipliers and scales scatter onto the same numerator', () => {
      const definition = fixture({
        paylines: [
          { id: 1, rows: [0, 0, 0, 0, 0] },
          { id: 2, rows: [1, 1, 1, 1, 1] },
        ],
      });
      const combined = combineReturn(
        definition,
        [
          { lineId: 1, symbolId: 'HI', count: 3, multiplierCenti: 1_000, positions: [] },
          { lineId: 2, symbolId: 'LO', count: 3, multiplierCenti: 500, positions: [] },
        ],
        { symbolId: 'SCAT', count: 3, multiplierCenti: 100, positions: [] },
      );
      // 1000 + 500 line centi, plus 2 lines * 100 scatter centi.
      expect(combined.returnNumerator).toBe(1_700);
      expect(combined.capped).toBe(false);
    });

    it('applies the max-win cap when it is reachable', () => {
      const capped = fixture({ maxWinCenti: 300 });
      const result = combineReturn(
        capped,
        [{ lineId: 1, symbolId: 'HI', count: 5, multiplierCenti: 20_000, positions: [] }],
        null,
      );
      // One payline, so the cap numerator is 300.
      expect(result.returnNumerator).toBe(300);
      expect(result.capped).toBe(true);
    });

    it('floors the payout exactly once against the total stake', () => {
      // 20 lines: payout = floor(stake * numerator / 2000)
      expect(slotPayout(game, 100n, 2_000)).toBe(100n);
      expect(slotPayout(game, 100n, 2_999)).toBe(149n);
      expect(slotPayout(game, 20n, 1)).toBe(0n);
      expect(slotPayout(game, 1_000n, 123_800)).toBe(61_900n);
    });
  });

  describe("Fool's Gold Rush v1 definition", () => {
    it('passes structural and mathematical validation', () => {
      expect(() => validateSlotDefinition(game)).not.toThrow();
      expect(slotDefinitions()).toContain(game);
      expect(findSlotDefinition('fools-gold-rush')).toBe(game);
      expect(findSlotDefinition('nope')).toBeUndefined();
    });

    it('is a 5x3 board with 20 well-formed paylines', () => {
      expect(game.reels).toBe(5);
      expect(game.rows).toBe(3);
      expect(game.paylines).toHaveLength(20);
      expect(game.strips).toHaveLength(5);
      for (const payline of game.paylines) {
        expect(payline.rows).toHaveLength(5);
        for (const row of payline.rows) {
          expect(row).toBeGreaterThanOrEqual(0);
          expect(row).toBeLessThan(3);
        }
      }
      expect(new Set(game.paylines.map((line) => line.id)).size).toBe(20);
    });

    it('names its version after its own exact RTP', () => {
      expect(slotVersion(game)).toBe('fools-gold-rush.v1.rtp9499');
    });

    it('resolves a spin consistently with its own stops', () => {
      const spin = resolveSpin(fairness(), game);
      expect(spin.matrix).toHaveLength(3);
      expect(spin.matrix[0]).toHaveLength(5);
      expect(resolveStops(game, spin.stops)).toEqual(spin);
      for (const win of spin.lineWins) {
        expect(win.count).toBeGreaterThanOrEqual(3);
        expect(win.positions).toHaveLength(win.count);
      }
    });
  });

  describe('exact theoretical RTP', () => {
    it('computes 94.993125% analytically and matches the declared metadata', () => {
      const analysis = analyseSlotRtp(game);
      expect(analysis.rtpPercent).toBe('94.993125');
      expect(analysis.rtpBps).toBe(9_499);
      expect(analysis.rtpBps).toBe(game.declaredRtpBps);
      expect(analysis.combinations).toBe(3_200_000n);
      expect(analysis.lineRtp.plus(analysis.scatterRtp).equals(analysis.rtp)).toBe(true);
    });

    it('is deterministic across repeated evaluation', () => {
      const first = analyseSlotRtp(game);
      const second = analyseSlotRtp(game);
      expect(first.rtp.equals(second.rtp)).toBe(true);
      expect(first.numerator).toBe(second.numerator);
      expect(first.denominator).toBe(second.denominator);
    });

    it('agrees exactly with exhaustive enumeration of all 3,200,000 stop combinations', () => {
      const analytic = analyseSlotRtp(game);
      const exhaustive = enumerateSlot(game);
      expect(exhaustive.combinations).toBe(3_200_000n);
      expect(exhaustive.rtp.equals(analytic.rtp)).toBe(true);
      expect(exhaustive.rtpPercent).toBe('94.993125');
    }, 120_000);

    it('proves the max-win cap can never bind, which keeps the model exact', () => {
      const exhaustive = enumerateSlot(game);
      const capNumerator = game.maxWinCenti * game.paylines.length;
      // The true achievable maximum is 61.90x total stake.
      expect(exhaustive.maxReturnCenti).toBe(123_800);
      expect(exhaustive.maxReturnCenti).toBeLessThan(capNumerator);
      expect(maxPossibleReturnNumerator(game)).toBeLessThan(capNumerator);
    }, 120_000);

    it('falls inside the platform RTP bounds', () => {
      expect(game.declaredRtpBps).toBeGreaterThanOrEqual(5_000);
      expect(game.declaredRtpBps).toBeLessThanOrEqual(9_950);
    });

    it('changes when the maths changes, and then fails metadata validation', () => {
      const base = analyseSlotRtp(game);

      const richerPaytable: SlotGameDefinition = {
        ...game,
        paytable: { ...game.paytable, GOLD: { 3: 9_000, 4: 30_000, 5: 200_000 } },
      };
      expect(analyseSlotRtp(richerPaytable).rtpBps).not.toBe(base.rtpBps);
      expect(() => validateSlotDefinition(richerPaytable)).toThrow(SlotDefinitionError);

      const richerStrip: SlotGameDefinition = {
        ...game,
        strips: game.strips.map((strip, reel) =>
          (reel === 0 ? ['GOLD', ...strip.slice(1)] : strip)),
      };
      expect(analyseSlotRtp(richerStrip).rtpBps).not.toBe(base.rtpBps);
      expect(() => validateSlotDefinition(richerStrip)).toThrow(SlotDefinitionError);
    });
  });

  describe('definition validation rejects invalid configuration', () => {
    const invalid = (overrides: Partial<SlotGameDefinition>, note: string) => {
      expect(() => validateSlotDefinition(fixture(overrides))).toThrow(SlotDefinitionError);
      expect(note).toBeTruthy();
    };

    it('rejects an empty or short strip', () => {
      invalid({ strips: [[], ['HI'], ['HI'], ['HI'], ['HI']] }, 'empty reel');
      invalid({ strips: [['HI'], ['HI'], ['HI'], ['HI'], ['HI']] }, 'shorter than the window');
    });

    it('rejects a strip count that does not match the reels', () => {
      invalid({ strips: [['HI', 'LO', 'WILD']] }, 'strip count');
    });

    it('rejects malformed paylines', () => {
      invalid({ paylines: [{ id: 1, rows: [0, 0, 0] }] }, 'wrong length');
      invalid({ paylines: [{ id: 1, rows: [0, 0, 0, 0, 3] }] }, 'row out of range');
      invalid({ paylines: [{ id: 1, rows: [0, 0, 0, 0, -1] }] }, 'negative row');
      invalid({ paylines: [] }, 'no paylines');
      invalid({
        paylines: [{ id: 1, rows: [0, 0, 0, 0, 0] }, { id: 1, rows: [1, 1, 1, 1, 1] }],
      }, 'duplicate id');
    });

    it('rejects paytable problems', () => {
      invalid({ paytable: { HI: { 3: 100, 4: 200, 5: 300 } } }, 'missing LO entry');
      invalid({
        paytable: { HI: { 3: 100, 4: 200 }, LO: { 3: 1, 4: 2, 5: 3 } },
      }, 'missing 5 of a kind');
      invalid({
        paytable: { HI: { 3: -1, 4: 200, 5: 300 }, LO: { 3: 1, 4: 2, 5: 3 } },
      }, 'negative payout');
      invalid({
        paytable: {
          HI: { 3: 1, 4: 2, 5: 3 }, LO: { 3: 1, 4: 2, 5: 3 },
          WILD: { 3: 1, 4: 2, 5: 3 },
        },
      }, 'paytable on a non-normal symbol');
    });

    it('rejects symbol and identity problems', () => {
      invalid({
        symbols: [
          { id: 'HI', name: 'a', type: 'NORMAL' },
          { id: 'HI', name: 'b', type: 'NORMAL' },
          { id: 'WILD', name: 'w', type: 'WILD' },
          { id: 'SCAT', name: 's', type: 'SCATTER' },
        ],
      }, 'duplicate symbol');
      invalid({ strips: Array(5).fill(['HI', 'LO', 'UNKNOWN', 'SCAT']) }, 'unknown symbol');
      invalid({ gameId: 'X' }, 'invalid id');
      invalid({ mathVersion: 0 }, 'invalid version');
    });

    it('rejects a reachable max-win cap and a mismatched declared RTP', () => {
      invalid({ maxWinCenti: 1 }, 'cap reachable');
      invalid({ maxWinCenti: 0 }, 'invalid cap');
      invalid({ declaredRtpBps: 1_234 }, 'declared RTP mismatch');
    });
  });
});
