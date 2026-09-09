import { Prisma } from '@prisma/client';
import { casinoConfig } from '../src/casino/casino.config';
import {
  CasinoFairnessService,
  FairnessInput,
  distinctPositions,
  hashServerSeed,
  uniformIntegers,
} from '../src/casino/casino-fairness.service';
import {
  diceIsWin,
  diceMultiplier,
  diceProbability,
  diceRoll,
  diceWinCount,
  resolveDice,
} from '../src/casino/games/dice/dice.engine';
import {
  binomial,
  minesMaxSafeCells,
  minesMultiplier,
  minesPayout,
  minesSurvivalProbability,
} from '../src/casino/games/mines/mines.engine';

/**
 * Distribution-independent tests. These assert the mapping, the bounds, and the
 * exact expected-value identities the configuration promises. They deliberately
 * do not assert that a small sample lands on particular outcomes, and they make
 * no statistical certification claim.
 */
describe('casino game mathematics', () => {
  const previous = { dice: process.env.CASINO_DICE_RTP_BPS, mines: process.env.CASINO_MINES_RTP_BPS };

  beforeAll(() => {
    process.env.CASINO_DICE_RTP_BPS = '9700';
    process.env.CASINO_MINES_RTP_BPS = '9700';
  });

  afterAll(() => {
    process.env.CASINO_DICE_RTP_BPS = previous.dice;
    process.env.CASINO_MINES_RTP_BPS = previous.mines;
  });

  const seed = 'a'.repeat(64);
  const fairness = (overrides: Partial<FairnessInput> = {}): FairnessInput => ({
    serverSeed: seed,
    domain: 'casino:test:v1',
    clientSeed: 'client',
    nonce: 0,
    ...overrides,
  });

  describe('configuration', () => {
    it('derives house edge as the complement of RTP and versions the configuration', () => {
      const config = casinoConfig();
      expect(config.dice.rtpBps).toBe(9700);
      expect(config.dice.houseEdgeBps).toBe(300);
      expect(config.dice.rtpBps + config.dice.houseEdgeBps).toBe(10_000);
      expect(config.dice.version).toBe('dice.v1.rtp9700');
      expect(config.mines.version).toBe('mines.v1.rtp9700');
    });

    it('ignores out-of-range RTP configuration instead of applying an unsafe value', () => {
      process.env.CASINO_DICE_RTP_BPS = '15000';
      expect(casinoConfig().dice.rtpBps).toBe(9700);
      process.env.CASINO_DICE_RTP_BPS = '10';
      expect(casinoConfig().dice.rtpBps).toBe(9700);
      process.env.CASINO_DICE_RTP_BPS = '9500';
      expect(casinoConfig().dice.rtpBps).toBe(9500);
      expect(casinoConfig().dice.version).toBe('dice.v1.rtp9500');
      process.env.CASINO_DICE_RTP_BPS = '9700';
    });
  });

  describe('dice', () => {
    const config = () => casinoConfig().dice;

    it('maps win counts from the target on both sides', () => {
      expect(diceWinCount('ROLL_UNDER', 5000, config())).toBe(5000);
      expect(diceWinCount('ROLL_OVER', 5000, config())).toBe(4999);
      expect(diceWinCount('ROLL_UNDER', 100, config())).toBe(100);
      expect(diceWinCount('ROLL_OVER', 9899, config())).toBe(100);
    });

    it('decides wins on the exact boundary', () => {
      expect(diceIsWin(4999, 'ROLL_UNDER', 5000)).toBe(true);
      expect(diceIsWin(5000, 'ROLL_UNDER', 5000)).toBe(false);
      expect(diceIsWin(5001, 'ROLL_OVER', 5000)).toBe(true);
      expect(diceIsWin(5000, 'ROLL_OVER', 5000)).toBe(false);
      expect(diceIsWin(4999, 'ROLL_OVER', 5000)).toBe(false);
    });

    it('pays the configured RTP in expectation for every legal target and mode', () => {
      const current = config();
      const rtp = new Prisma.Decimal(current.rtpBps).div(10_000);
      for (const mode of ['ROLL_UNDER', 'ROLL_OVER'] as const) {
        for (const target of [100, 250, 1000, 2500, 5000, 7500, 9000, 9899]) {
          const expected = diceProbability(mode, target, current)
            .mul(diceMultiplier(mode, target, current));
          // Truncation to 8 decimals can only ever round the payout down.
          expect(expected.lessThanOrEqualTo(rtp)).toBe(true);
          expect(rtp.minus(expected).lessThan(new Prisma.Decimal('0.0000001'))).toBe(true);
        }
      }
    });

    it('computes the multiplier as rtpBps divided by the winning-outcome count', () => {
      const current = config();
      expect(diceMultiplier('ROLL_UNDER', 5000, current).toString()).toBe('1.94');
      expect(diceMultiplier('ROLL_UNDER', 100, current).toString()).toBe('97');
      expect(diceMultiplier('ROLL_UNDER', 2500, current).toString()).toBe('3.88');
    });

    it('rejects a target that admits no winning outcome', () => {
      expect(() => diceMultiplier('ROLL_OVER', 9999, config())).toThrow(RangeError);
    });

    it('keeps every derived roll inside the configured scale', () => {
      const current = config();
      for (let nonce = 0; nonce < 200; nonce += 1) {
        const roll = diceRoll(fairness({ nonce }), current);
        expect(Number.isInteger(roll)).toBe(true);
        expect(roll).toBeGreaterThanOrEqual(0);
        expect(roll).toBeLessThan(current.scale);
      }
    });

    it('reproduces the identical roll from identical fairness inputs', () => {
      const current = config();
      expect(diceRoll(fairness(), current)).toBe(diceRoll(fairness(), current));
      expect(diceRoll(fairness(), current)).not.toBe(
        diceRoll(fairness({ clientSeed: 'other' }), current),
      );
    });

    it('floors the payout and pays nothing on a loss', () => {
      const current = config();
      const resolution = resolveDice(fairness(), current, 'ROLL_UNDER', 5000, 101n);
      expect(resolution.payout).toBe(resolution.won ? 195n : 0n);
    });
  });

  describe('mines', () => {
    const config = () => casinoConfig().mines;

    it('computes exact binomial coefficients', () => {
      expect(binomial(25, 0)).toBe(1n);
      expect(binomial(25, 1)).toBe(25n);
      expect(binomial(25, 12)).toBe(5_200_300n);
      expect(binomial(24, 24)).toBe(1n);
      expect(binomial(5, 9)).toBe(0n);
    });

    it('returns the configured RTP in expectation for every mine count and depth', () => {
      const current = config();
      const rtp = new Prisma.Decimal(current.rtpBps).div(10_000);
      for (let mines = current.minMines; mines <= current.maxMines; mines += 1) {
        for (let revealed = 1; revealed <= minesMaxSafeCells(current, mines); revealed += 1) {
          const expected = minesSurvivalProbability(current, mines, revealed)
            .mul(minesMultiplier(current, mines, revealed));
          // Both the binomial ratio and the multiplier are rounded Decimals, so
          // the identity holds to within rounding rather than exactly. The
          // observed worst case across the whole table is 7.5e-9, which is far
          // below one virtual point at any permitted stake.
          expect(expected.minus(rtp).abs().lessThan(new Prisma.Decimal('0.0000001'))).toBe(true);
        }
      }
    });

    it('increases the multiplier monotonically as more cells are cleared', () => {
      const current = config();
      for (const mines of [1, 3, 5, 12, 24]) {
        let previousMultiplier = new Prisma.Decimal(0);
        for (let revealed = 1; revealed <= minesMaxSafeCells(current, mines); revealed += 1) {
          const multiplier = minesMultiplier(current, mines, revealed);
          expect(multiplier.greaterThan(previousMultiplier)).toBe(true);
          previousMultiplier = multiplier;
        }
      }
    });

    it('keeps a maximum-stake clearance inside the safe payout range', () => {
      const current = config();
      for (let mines = current.minMines; mines <= current.maxMines; mines += 1) {
        const top = minesMultiplier(current, mines, minesMaxSafeCells(current, mines));
        expect(minesPayout(current.maxStake, top)).toBeLessThan(9_000_000_000_000_000n);
      }
    });

    it('places exactly the requested number of distinct in-range mines', () => {
      const current = config();
      for (const mines of [1, 5, 12, 24]) {
        const board = distinctPositions(fairness({ nonce: mines }), current.cells, mines);
        expect(board).toHaveLength(mines);
        expect(new Set(board).size).toBe(mines);
        for (const cell of board) {
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(cell).toBeLessThan(current.cells);
        }
      }
    });

    it('reproduces the identical board from identical fairness inputs', () => {
      const current = config();
      expect(distinctPositions(fairness(), current.cells, 5))
        .toEqual(distinctPositions(fairness(), current.cells, 5));
      expect(distinctPositions(fairness(), current.cells, 5))
        .not.toEqual(distinctPositions(fairness({ nonce: 1 }), current.cells, 5));
    });
  });

  describe('fairness engine', () => {
    const service = new CasinoFairnessService();

    it('commits to a seed that verifies only against its own hash', () => {
      const commitment = service.createCommitment();
      expect(commitment.serverSeed).toMatch(/^[0-9a-f]{64}$/);
      expect(commitment.serverSeedHash).toBe(hashServerSeed(commitment.serverSeed));
      expect(service.verifyCommitment(commitment.serverSeed, commitment.serverSeedHash)).toBe(true);
      expect(service.verifyCommitment('b'.repeat(64), commitment.serverSeedHash)).toBe(false);
    });

    it('produces fresh unpredictable seeds per round', () => {
      const seeds = new Set(Array.from({ length: 50 }, () => service.createCommitment().serverSeed));
      expect(seeds.size).toBe(50);
    });

    it('separates games by domain so one seed cannot correlate two games', () => {
      expect(uniformIntegers(fairness({ domain: 'casino:dice:v1' }), 10_000, 8))
        .not.toEqual(uniformIntegers(fairness({ domain: 'casino:mines:v1' }), 10_000, 8));
    });

    it('keeps every uniform draw within the requested bound', () => {
      for (const bound of [2, 25, 37, 10_000]) {
        for (const value of uniformIntegers(fairness(), bound, 500)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(bound);
        }
      }
    });

    it('rejects an invalid bound rather than emitting a biased value', () => {
      expect(() => uniformIntegers(fairness(), 0, 1)).toThrow(RangeError);
      expect(() => distinctPositions(fairness(), 25, 26)).toThrow(RangeError);
    });
  });
});
