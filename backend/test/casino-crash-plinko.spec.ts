import { Prisma } from '@prisma/client';
import { casinoConfig } from '../src/casino/casino.config';
import { FairnessInput } from '../src/casino/casino-fairness.service';
import {
  CRASH_UNIFORM_BOUND,
  crashCurveCenti,
  crashCurveCentiForTicks,
  crashElapsedMsToReach,
  crashExpectedReturn,
  crashPayout,
  crashPointFromDraw,
  crashSuccessProbability,
  crashTicks,
  deriveCrashPointCenti,
  resolveCrash,
} from '../src/casino/games/crash/crash.engine';
import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  PlinkoRisk,
  isSupportedRisk,
  isSupportedRows,
  plinkoBucket,
  plinkoBucketProbability,
  plinkoPath,
  plinkoPaytable,
  plinkoPaytableCenti,
  plinkoTheoreticalRtp,
  plinkoTheoreticalRtpBps,
  plinkoVersion,
  resolvePlinko,
} from '../src/casino/games/plinko/plinko.engine';

/**
 * Mapping, bound and expected-value tests. As with the other games these are
 * distribution-independent: nothing asserts that a particular seed produces a
 * particular outcome, and no statistical certification is claimed.
 */
describe('crash and plinko mathematics', () => {
  const fairness = (overrides: Partial<FairnessInput> = {}): FairnessInput => ({
    serverSeed: 'd'.repeat(64),
    domain: 'casino:test:v1',
    clientSeed: 'client',
    nonce: 0,
    ...overrides,
  });

  describe('crash configuration', () => {
    it('versions the configuration with its effective RTP', () => {
      const config = casinoConfig().crash;
      expect(config.rtpBps).toBe(9_700);
      expect(config.houseEdgeBps).toBe(300);
      expect(config.rtpBps + config.houseEdgeBps).toBe(10_000);
      expect(config.version).toBe('crash.v1.rtp9700');
    });

    it('ignores an out-of-range RTP instead of applying an unsafe value', () => {
      const previous = process.env.CASINO_CRASH_RTP_BPS;
      process.env.CASINO_CRASH_RTP_BPS = '20000';
      expect(casinoConfig().crash.rtpBps).toBe(9_700);
      process.env.CASINO_CRASH_RTP_BPS = '9500';
      expect(casinoConfig().crash.version).toBe('crash.v1.rtp9500');
      process.env.CASINO_CRASH_RTP_BPS = previous;
    });
  });

  describe('crash curve', () => {
    const config = () => casinoConfig().crash;

    it('starts at exactly 1.00x', () => {
      expect(crashCurveCenti(0, config())).toBe(100);
      expect(crashCurveCenti(-500, config())).toBe(100);
      expect(crashCurveCenti(49, config())).toBe(100);
    });

    it('advances one tick per configured interval', () => {
      const current = config();
      expect(crashTicks(0, current)).toBe(0);
      expect(crashTicks(49, current)).toBe(0);
      expect(crashTicks(50, current)).toBe(1);
      expect(crashTicks(99, current)).toBe(1);
      expect(crashTicks(1_000, current)).toBe(20);
    });

    it('is monotonically non-decreasing in elapsed time', () => {
      const current = config();
      let previous = 0;
      for (let elapsed = 0; elapsed <= 120_000; elapsed += 250) {
        const value = crashCurveCenti(elapsed, current);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    });

    it('never produces a non-finite value and stays inside its bounds', () => {
      const current = config();
      for (const elapsed of [0, 1, 1_000, 60_000, 92_350, 500_000, 86_400_000]) {
        const value = crashCurveCenti(elapsed, current);
        expect(Number.isFinite(value)).toBe(true);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(current.minMultiplierCenti);
        expect(value).toBeLessThanOrEqual(current.maxMultiplierCenti);
      }
    });

    it('saturates at the cap rather than growing without bound', () => {
      const current = config();
      const capElapsed = crashElapsedMsToReach(current.maxMultiplierCenti, current);
      expect(crashCurveCenti(capElapsed, current)).toBe(current.maxMultiplierCenti);
      expect(crashCurveCenti(capElapsed * 10, current)).toBe(current.maxMultiplierCenti);
    });

    it('reaches the documented landmarks', () => {
      const current = config();
      // 1.005 per 50ms: 2.00x at 139 ticks, 10.00x at 462 ticks.
      expect(crashCurveCentiForTicks(139, current)).toBeGreaterThanOrEqual(200);
      expect(crashCurveCentiForTicks(138, current)).toBeLessThan(200);
      expect(crashElapsedMsToReach(200, current)).toBe(139 * current.tickMs);
      expect(crashElapsedMsToReach(1_000, current)).toBe(462 * current.tickMs);
      expect(crashElapsedMsToReach(100, current)).toBe(0);
    });

    it('inverts consistently: the returned instant is the first that reaches the target', () => {
      const current = config();
      for (const target of [101, 150, 200, 500, 1_000, 10_000, 500_000]) {
        const at = crashElapsedMsToReach(target, current);
        expect(crashCurveCenti(at, current)).toBeGreaterThanOrEqual(target);
        if (at > 0) expect(crashCurveCenti(at - current.tickMs, current)).toBeLessThan(target);
      }
    });
  });

  describe('crash point derivation', () => {
    const config = () => casinoConfig().crash;

    it('maps the uniform draw monotonically downward', () => {
      const current = config();
      let previous = Number.POSITIVE_INFINITY;
      for (const draw of [0, 1, 1_000, 1_000_000, 2 ** 30, 2 ** 32 - 1]) {
        const point = crashPointFromDraw(draw, current);
        expect(point).toBeLessThanOrEqual(previous);
        previous = point;
      }
    });

    it('clamps to the configured bounds at both extremes', () => {
      const current = config();
      expect(crashPointFromDraw(0, current)).toBe(current.maxMultiplierCenti);
      expect(crashPointFromDraw(CRASH_UNIFORM_BOUND - 1, current))
        .toBe(current.minMultiplierCenti);
    });

    it('busts instantly with probability equal to the house edge', () => {
      const current = config();
      // The raw value drops below 1.00x once u + 1 exceeds rtp * 2^32 / 10000.
      const survivors = Math.floor(current.rtpBps * CRASH_UNIFORM_BOUND / 10_000);
      const bustShare = 1 - survivors / CRASH_UNIFORM_BOUND;
      expect(bustShare).toBeCloseTo(current.houseEdgeBps / 10_000, 9);
    });

    it('returns exactly the configured RTP in expectation for every target', () => {
      const current = config();
      const rtp = new Prisma.Decimal(current.rtpBps).div(10_000);
      for (const target of [100, 101, 150, 200, 350, 1_000, 5_000, 100_000]) {
        const expected = crashExpectedReturn(target, current);
        // The integer floor in the count can only ever favour the house.
        expect(expected.lessThanOrEqualTo(rtp)).toBe(true);
        expect(rtp.minus(expected).lessThan(new Prisma.Decimal('0.0001'))).toBe(true);
      }
    });

    it('states the survival probability as RTP divided by the target', () => {
      const current = config();
      for (const target of [200, 1_000, 10_000]) {
        const probability = crashSuccessProbability(target, current);
        const analytic = new Prisma.Decimal(current.rtpBps)
          .div(10_000)
          .div(new Prisma.Decimal(target).div(100));
        expect(analytic.minus(probability).abs().lessThan(new Prisma.Decimal('0.000001')))
          .toBe(true);
      }
    });

    it('reproduces the identical crash point from identical fairness inputs', () => {
      const current = config();
      expect(deriveCrashPointCenti(fairness(), current))
        .toBe(deriveCrashPointCenti(fairness(), current));
      expect(deriveCrashPointCenti(fairness(), current))
        .not.toBe(deriveCrashPointCenti(fairness({ nonce: 1 }), current));
    });

    it('keeps every derived crash point inside the configured bounds', () => {
      const current = config();
      for (let nonce = 0; nonce < 300; nonce += 1) {
        const point = deriveCrashPointCenti(fairness({ nonce }), current);
        expect(point).toBeGreaterThanOrEqual(current.minMultiplierCenti);
        expect(point).toBeLessThanOrEqual(current.maxMultiplierCenti);
        expect(Number.isInteger(point)).toBe(true);
      }
    });
  });

  describe('crash boundary policy', () => {
    const config = () => casinoConfig().crash;
    const at = (targetCenti: number) => crashElapsedMsToReach(targetCenti, config());

    it('crashes when the curve reaches the crash point, not after it', () => {
      const current = config();
      const crashPointCenti = 200;
      const justBefore = resolveCrash({
        elapsedMs: at(crashPointCenti) - current.tickMs,
        crashPointCenti,
        autoCashoutCenti: null,
        config: current,
      });
      expect(justBefore.terminal).toBe(false);

      const exactly = resolveCrash({
        elapsedMs: at(crashPointCenti),
        crashPointCenti,
        autoCashoutCenti: null,
        config: current,
      });
      expect(exactly.terminal).toBe(true);
      expect(exactly.terminal && exactly.outcome).toBe('LOST');
    });

    it('treats a crash point at the floor as an unwinnable round', () => {
      const current = config();
      const resolution = resolveCrash({
        elapsedMs: 0,
        crashPointCenti: current.minMultiplierCenti,
        autoCashoutCenti: null,
        config: current,
      });
      expect(resolution.terminal && resolution.outcome).toBe('LOST');
    });

    it('fires an auto-cashout strictly below the crash point at its exact target', () => {
      const current = config();
      const resolution = resolveCrash({
        elapsedMs: at(200),
        crashPointCenti: 500,
        autoCashoutCenti: 200,
        config: current,
      });
      expect(resolution.terminal && resolution.outcome).toBe('CASHED_OUT');
      expect(resolution.terminal && resolution.atCenti).toBe(200);
      expect(resolution.terminal && resolution.automatic).toBe(true);
    });

    it('loses when the auto-cashout sits at or above the crash point', () => {
      const current = config();
      for (const autoCashoutCenti of [500, 900]) {
        const resolution = resolveCrash({
          elapsedMs: at(900),
          crashPointCenti: 500,
          autoCashoutCenti,
          config: current,
        });
        expect(resolution.terminal && resolution.outcome).toBe('LOST');
      }
    });

    it('stays open before either threshold is reached', () => {
      const current = config();
      const resolution = resolveCrash({
        elapsedMs: at(150),
        crashPointCenti: 500,
        autoCashoutCenti: 400,
        config: current,
      });
      expect(resolution.terminal).toBe(false);
    });

    it('floors the payout against the stake', () => {
      expect(crashPayout(101n, 194)).toBe(195n);
      expect(crashPayout(100n, 100)).toBe(100n);
      expect(crashPayout(333n, 250)).toBe(832n);
    });
  });

  describe('plinko configuration and paytables', () => {
    const config = () => casinoConfig().plinko;

    it('supports only the declared boards', () => {
      expect([...PLINKO_ROWS]).toEqual([8, 12, 16]);
      expect(PLINKO_RISKS).toEqual(['LOW', 'MEDIUM', 'HIGH']);
      for (const rows of [8, 12, 16]) expect(isSupportedRows(rows)).toBe(true);
      for (const rows of [0, 1, 7, 9, 13, 17, 100, -8]) {
        expect(isSupportedRows(rows)).toBe(false);
      }
      for (const risk of ['LOW', 'MEDIUM', 'HIGH']) expect(isSupportedRisk(risk)).toBe(true);
      for (const risk of ['low', 'EXTREME', '', 'MED']) expect(isSupportedRisk(risk)).toBe(false);
    });

    it('publishes one multiplier per bucket', () => {
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) {
          expect(plinkoPaytableCenti(rows, risk)).toHaveLength(rows + 1);
          expect(plinkoPaytable(rows, risk)).toHaveLength(rows + 1);
        }
      }
    });

    it('keeps every paytable symmetric and positive', () => {
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) {
          const table = plinkoPaytableCenti(rows, risk);
          expect(table).toEqual([...table].reverse());
          for (const value of table) expect(value).toBeGreaterThan(0);
        }
      }
    });

    it('increases outward from the centre for every board', () => {
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) {
          const table = plinkoPaytableCenti(rows, risk);
          const centre = rows / 2;
          for (let bucket = 0; bucket < centre; bucket += 1) {
            expect(table[bucket]).toBeGreaterThanOrEqual(table[bucket + 1]);
          }
          expect(table[centre]).toBe(Math.min(...table));
        }
      }
    });

    it('raises variance as the risk level increases', () => {
      for (const rows of PLINKO_ROWS) {
        const low = plinkoPaytableCenti(rows, 'LOW');
        const medium = plinkoPaytableCenti(rows, 'MEDIUM');
        const high = plinkoPaytableCenti(rows, 'HIGH');
        expect(Math.max(...medium)).toBeGreaterThan(Math.max(...low));
        expect(Math.max(...high)).toBeGreaterThan(Math.max(...medium));
        expect(Math.min(...medium)).toBeLessThan(Math.min(...low));
        expect(Math.min(...high)).toBeLessThan(Math.min(...medium));
      }
    });

    it('sums the bucket probabilities to exactly one', () => {
      for (const rows of PLINKO_ROWS) {
        let total = new Prisma.Decimal(0);
        for (let bucket = 0; bucket <= rows; bucket += 1) {
          total = total.plus(plinkoBucketProbability(rows, bucket));
        }
        expect(total.equals(1)).toBe(true);
      }
    });

    it('computes each theoretical RTP within the declared tolerance of the target', () => {
      const current = config();
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) {
          const bps = plinkoTheoreticalRtpBps(rows, risk);
          expect(Math.abs(bps - current.targetRtpBps))
            .toBeLessThanOrEqual(current.rtpToleranceBps);
          // Must also respect the platform-wide RTP bounds.
          expect(bps).toBeGreaterThanOrEqual(5_000);
          expect(bps).toBeLessThanOrEqual(9_950);
        }
      }
    });

    it('derives the theoretical RTP from the paytable itself', () => {
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) {
          const table = plinkoPaytableCenti(rows, risk);
          let expected = new Prisma.Decimal(0);
          for (let bucket = 0; bucket <= rows; bucket += 1) {
            expected = expected.plus(
              plinkoBucketProbability(rows, bucket)
                .mul(new Prisma.Decimal(table[bucket]).div(100)),
            );
          }
          expect(plinkoTheoreticalRtp(rows, risk).equals(expected)).toBe(true);
        }
      }
    });

    it('names each board version by rows, risk and its own exact RTP', () => {
      const current = config();
      expect(plinkoVersion(current, 8, 'LOW')).toBe('plinko.v1.r8.low.rtp9700');
      expect(plinkoVersion(current, 16, 'HIGH'))
        .toBe(`plinko.v1.r16.high.rtp${plinkoTheoreticalRtpBps(16, 'HIGH')}`);
      const versions = new Set<string>();
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) versions.add(plinkoVersion(current, rows, risk));
      }
      expect(versions.size).toBe(9);
    });

    it('rejects an unknown board rather than guessing a table', () => {
      expect(() => plinkoPaytableCenti(10, 'LOW')).toThrow(RangeError);
      expect(() => plinkoPaytableCenti(8, 'EXTREME' as PlinkoRisk)).toThrow(RangeError);
    });
  });

  describe('plinko path and bucket', () => {
    it('derives exactly one decision per row, each left or right', () => {
      for (const rows of PLINKO_ROWS) {
        const path = plinkoPath(fairness(), rows);
        expect(path).toHaveLength(rows);
        for (const step of path) expect(['L', 'R']).toContain(step);
      }
    });

    it('counts the bucket as the number of right decisions', () => {
      expect(plinkoBucket(['L', 'L', 'L'])).toBe(0);
      expect(plinkoBucket(['R', 'R', 'R'])).toBe(3);
      expect(plinkoBucket(['L', 'R', 'L', 'R'])).toBe(2);
      expect(plinkoBucket([])).toBe(0);
    });

    it('keeps every derived bucket inside the board', () => {
      for (const rows of PLINKO_ROWS) {
        for (let nonce = 0; nonce < 120; nonce += 1) {
          const bucket = plinkoBucket(plinkoPath(fairness({ nonce }), rows));
          expect(bucket).toBeGreaterThanOrEqual(0);
          expect(bucket).toBeLessThanOrEqual(rows);
        }
      }
    });

    it('reproduces the identical path from identical fairness inputs', () => {
      expect(plinkoPath(fairness(), 12)).toEqual(plinkoPath(fairness(), 12));
      expect(plinkoPath(fairness(), 12)).not.toEqual(plinkoPath(fairness({ nonce: 1 }), 12));
      expect(plinkoPath(fairness({ domain: 'a' }), 12))
        .not.toEqual(plinkoPath(fairness({ domain: 'b' }), 12));
    });

    it('resolves a drop consistently with its own path and paytable', () => {
      for (const rows of PLINKO_ROWS) {
        for (const risk of PLINKO_RISKS) {
          const resolution = resolvePlinko(fairness({ nonce: rows }), rows, risk, 1_000n);
          expect(resolution.path).toHaveLength(rows);
          expect(resolution.bucketIndex).toBe(plinkoBucket(resolution.path));
          expect(resolution.multiplierCenti)
            .toBe(plinkoPaytableCenti(rows, risk)[resolution.bucketIndex]);
          expect(resolution.payout).toBe((1_000n * BigInt(resolution.multiplierCenti)) / 100n);
          expect(resolution.paytable).toEqual(plinkoPaytable(rows, risk));
        }
      }
    });
  });
});
