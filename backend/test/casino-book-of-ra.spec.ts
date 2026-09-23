import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOOK_OF_RA_GAME,
  BOOK_OF_RA_PROFILE,
  BOOK_OF_RA_SCATTER_PAYS,
  bookOfRaExpandingMinimum,
  bookOfRaExpandingWin,
  bookOfRaPayout,
  evaluateBookOfRa,
  validateBookOfRaProfile,
  type Grid,
} from '@slot-skills/math';
import { BookOfRaService } from '../src/casino/games/book-of-ra/book-of-ra.service';
import { GAME_CONFIG_SPECS } from '../src/casino/casino-config.defaults';
import {
  BOOK_ACTIVE_LINES,
  BOOK_PROFILE_FINGERPRINT,
  BOOK_PROFILE_ID,
  publicBookOfRaConfig,
} from '../src/casino/games/book-of-ra/book-of-ra.definition';

/**
 * Pure tests for the published Book of the Sands mathematics.
 *
 * No Nest container, no database and no HTTP: these read the frozen profile the
 * production adapter serves and the compiled definition the player shell loads,
 * so a drift between the code, the data file and the published rules fails here.
 */
describe('book of the sands: published profile', () => {
  const blank = (symbolId = 'low-5'): Grid => Array.from({ length: 5 }, () => [symbolId, symbolId, symbolId]);

  it('rounds the configured minimum up to a whole bet per line', () => {
    const config = publicBookOfRaConfig({ minStake: 101n, maxStake: 1_000_000n });
    expect(config.minBetPerLine).toBe('11');
    expect(config.minTotalBet).toBe('110');
  });

  it('keeps configuration revision labels unique without changing the math profile', () => {
    const spec = GAME_CONFIG_SPECS['book-of-ra'];
    const baseline = spec.baseline();
    const labels = [baseline.label, spec.label(baseline, 2), spec.label(baseline, 3)];
    expect(new Set(labels).size).toBe(3);
    expect(baseline.gameSpecific.profile).toBe(BOOK_PROFILE_ID);
  });

  it('keeps a five-by-three board, ten fixed lines and the canonical paytable', () => {
    expect(BOOK_OF_RA_GAME.layout.reels).toBe(5);
    expect(BOOK_OF_RA_GAME.layout.rows).toBe(3);
    expect(BOOK_OF_RA_GAME.math.paylines).toHaveLength(BOOK_ACTIVE_LINES);
    expect(BOOK_OF_RA_GAME.math.outcomeGenerator).toBe('weighted-grid');
    expect(BOOK_OF_RA_GAME.math.reelStrips).toBeUndefined();
    for (const [symbolId, tiers] of Object.entries(BOOK_OF_RA_PROFILE.paytable)) {
      for (const [count, multiplier] of Object.entries(tiers)) {
        expect(bookOfRaPayout(symbolId, Number(count))).toBe(multiplier);
      }
    }
    expect(bookOfRaPayout('high-1', 2)).toBe(10);
    expect(bookOfRaPayout('low-5', 2)).toBe(0);
    expect(bookOfRaPayout('high-1', 5)).toBe(5000);
  });

  it('pays three, four and five Books on the total stake', () => {
    const totalBet = 10n * BigInt(BOOK_ACTIVE_LINES);
    for (const [count, multiplier] of Object.entries(BOOK_OF_RA_SCATTER_PAYS)) {
      const grid = blank();
      for (let index = 0; index < Number(count); index += 1) grid[Math.floor(index / 3)]![index % 3] = 'scatter';
      const evaluation = evaluateBookOfRa(BOOK_OF_RA_GAME, grid, 10n, BOOK_ACTIVE_LINES);
      expect(evaluation.scatterWin).toBe(totalBet * BigInt(multiplier));
    }
  });

  it('expands high symbols from two reels and honour cards from three', () => {
    expect(bookOfRaExpandingMinimum('high-1')).toBe(2);
    expect(bookOfRaExpandingMinimum('low-1')).toBe(3);
    // Two reels of high-2 pays 5x the line bet across ten lines.
    expect(bookOfRaExpandingWin('high-2', 2, 10n, BOOK_ACTIVE_LINES)).toBe(500n);
    expect(bookOfRaExpandingWin('high-2', 3, 10n, BOOK_ACTIVE_LINES)).toBe(4000n);
    // The same two reels pay nothing for an honour card.
    expect(bookOfRaExpandingWin('low-1', 2, 10n, BOOK_ACTIVE_LINES)).toBe(0n);
    expect(bookOfRaExpandingWin('low-1', 3, 10n, BOOK_ACTIVE_LINES)).toBe(500n);
    // The Book is never the expanding symbol.
    expect(bookOfRaExpandingWin('scatter', 5, 10n, BOOK_ACTIVE_LINES)).toBe(0n);
  });

  it('is immutable and self-validating', () => {
    expect(Object.isFrozen(BOOK_OF_RA_GAME)).toBe(true);
    expect(Object.isFrozen(BOOK_OF_RA_GAME.math.symbolWeights)).toBe(true);
    expect(Object.isFrozen(BOOK_OF_RA_PROFILE)).toBe(true);
    expect(() => validateBookOfRaProfile()).not.toThrow();
    expect(BOOK_PROFILE_ID).toBe('book-of-ra.v1.rtp5000');
    expect(BOOK_OF_RA_PROFILE.declaredRtpBps).toBe(5_000);
    expect(BOOK_PROFILE_FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
  });

  it('publishes rules that match the mathematics it ships', () => {
    const config = publicBookOfRaConfig({ minStake: 10n, maxStake: 1_000_000n });
    expect(config.paylineCount).toBe(BOOK_ACTIVE_LINES);
    expect(config.freeSpins).toEqual({ trigger: 3, award: 10, retrigger: 10, retriggerTrigger: 3 });
    expect(config.gamble.maxAttempts).toBe(5);
    expect(config.gamble.availableDuringAutoplay).toBe(false);
    expect(config.expansion).toMatchObject({ highSymbolReels: 2, lowSymbolReels: 3, adjacentRequired: false });
    expect(config.scatter).toEqual({ 3: 2, 4: 20, 5: 200 });
    expect(JSON.stringify(config)).not.toContain('serverSeed');
  });

  it('agrees with the compiled game definition the player shell loads', () => {
    const bundle = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'games', 'book-of-ra', 'book-of-the-sands', 'build', 'game.bundle.json'), 'utf8'),
    ) as {
      id: string;
      math: { symbolWeights: Record<string, number>; paylines: number[][]; targets: { rtpBps: number }; paytable: Array<{ symbolId: string; count: number; payout: { numerator: string } }> };
      features: Array<{ id: string; enabled: boolean }>;
    };
    expect(bundle.id).toBe(BOOK_OF_RA_GAME.id);
    expect(bundle.math.symbolWeights).toEqual(BOOK_OF_RA_PROFILE.symbolWeights);
    expect(bundle.math.paylines).toEqual(BOOK_OF_RA_GAME.math.paylines);
    expect(bundle.math.targets.rtpBps).toBe(BOOK_OF_RA_PROFILE.declaredRtpBps);
    for (const [symbolId, tiers] of Object.entries(BOOK_OF_RA_PROFILE.paytable)) {
      for (const [count, multiplier] of Object.entries(tiers)) {
        const entry = bundle.math.paytable.find((candidate) => candidate.symbolId === symbolId && candidate.count === Number(count));
        expect(entry?.payout.numerator).toBe(String(multiplier));
      }
    }
    const enabled = bundle.features.filter((feature) => feature.enabled).map((feature) => feature.id).sort();
    expect(enabled).toEqual(['free-spins', 'gamble-feature', 'retriggering-free-spins', 'scatter-trigger', 'symbol-expansion']);
  });

  it('refuses a deterministic RNG outside a test process', () => {
    const service = new BookOfRaService(
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() => service.useTestRngFactory(() => ({ id: 'x', production: false, uniformInt: async () => ({ value: 0, maxExclusive: 1, index: 0, source: 'x', reference: 'x' }) }))).toThrow(/only be installed in tests/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
