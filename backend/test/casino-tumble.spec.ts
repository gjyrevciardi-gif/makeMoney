import { FairnessInput } from '../src/casino/casino-fairness.service';
import {
  TITANS_TEMPEST_V1,
  TumbleDefinitionError,
  findTumbleDefinition,
  maxBoardCenti,
  orbWeightTotal,
  symbolWeightTotal,
  tumbleDefinitions,
  tumbleVersion,
  validateTumbleDefinition,
} from '../src/casino/games/slots/tumble.definition';
import {
  bandFor,
  buildTables,
  clearAndDrop,
  evaluateBoard,
  openingBoard,
  playFeature,
  playSpin,
  positionsOf,
  resolveTumbleRound,
  scatterCentiFor,
  totalMultiplier,
  tumbleCharge,
  tumbleDomain,
  tumblePayout,
} from '../src/casino/games/slots/tumble.engine';
import { SimulationStream, simulateTumbleRtp } from '../src/casino/games/slots/tumble.rtp';
import { TumbleCell, TumbleGameDefinition } from '../src/casino/games/slots/tumble.types';

/**
 * Pure tumbling-slot tests. No Nest, no database, no HTTP.
 *
 * The return here is measured, not enumerated - a tumble chain has no closed
 * form - so the RTP test is an explicit regression guard against the definition
 * drifting, with a tolerance wide enough to cover simulation noise and narrow
 * enough to catch a real change. It is not, and must never be described as, a
 * certification.
 */
describe('tumbling slot engine and mathematics', () => {
  const game = TITANS_TEMPEST_V1;
  const tables = buildTables(game);

  const fairness = (overrides: Partial<FairnessInput> = {}): FairnessInput => ({
    serverSeed: 'a'.repeat(64),
    domain: 'casino:test:tumble:v1',
    clientSeed: 'client',
    nonce: 0,
    ...overrides,
  });

  /**
   * A stream that always draws the top of every range. It never rolls an orb
   * and always lands on the last paying symbol in the weight table, so a refill
   * is a known, inert value and a tumble test can assert on the survivors.
   */
  const azureFill = { nextBelow: (bound: number) => bound - 1 };

  /** Builds a board from row strings of symbol ids separated by spaces. */
  const board = (rows: string[][]): TumbleCell[][] =>
    rows.map((row) => row.map((symbol) => ({ symbol })));

  describe('the definition', () => {
    it('validates the built-in game and publishes a version that names its return', () => {
      expect(() => validateTumbleDefinition(game)).not.toThrow();
      expect(tumbleVersion(game)).toBe(`titans-tempest.v1.rtp${game.declaredRtpBps}`);
      expect(tumbleDefinitions()).toContain(game);
      expect(findTumbleDefinition('titans-tempest')).toBe(game);
      expect(findTumbleDefinition('not-a-game')).toBeUndefined();
    });

    it('declares weight tables that sum to what the engine draws against', () => {
      expect(symbolWeightTotal(game)).toBe(
        Object.values(game.symbolWeights).reduce((sum, weight) => sum + weight, 0),
      );
      expect(orbWeightTotal(game)).toBe(
        game.orbFaces.reduce((sum, face) => sum + face.weight, 0),
      );
      // Every paying symbol has a weight, and nothing else does.
      const paying = game.symbols.filter((symbol) => symbol.type === 'PAY').map((s) => s.id);
      expect(Object.keys(game.symbolWeights).sort()).toEqual([...paying].sort());
    });

    const broken = (patch: Partial<TumbleGameDefinition>): TumbleGameDefinition =>
      ({ ...game, ...patch });

    it.each([
      ['bands that do not descend', broken({
        paytable: { ...game.paytable, CROWN: [{ min: 8, centi: 10 }, { min: 12, centi: 20 }] },
      })],
      ['a band that pays more for fewer symbols', broken({
        paytable: {
          ...game.paytable,
          CROWN: [{ min: 12, centi: 10 }, { min: 10, centi: 20 }, { min: 8, centi: 5 }],
        },
      })],
      ['no band at the minimum cluster', broken({
        paytable: { ...game.paytable, CROWN: [{ min: 12, centi: 100 }] },
      })],
      ['a duplicated wire code', broken({
        symbols: game.symbols.map((symbol) =>
          (symbol.id === 'CROWN' ? { ...symbol, code: 'H' } : symbol)),
      })],
      ['a cap one board could reach on its own', broken({ maxWinCenti: 10 })],
      ['a return outside the platform bounds', broken({ declaredRtpBps: 100 })],
      ['an orb face below two', broken({ orbFaces: [{ value: 1, weight: 1 }] })],
      ['a scatter count the board cannot hold', broken({ scatterPay: { 9: 100 } })],
    ])('refuses %s', (_label, definition) => {
      expect(() => validateTumbleDefinition(definition)).toThrow(TumbleDefinitionError);
    });

    it('keeps the structural cap above anything one board can pay', () => {
      expect(game.maxWinCenti).toBeGreaterThan(maxBoardCenti(game));
    });
  });

  describe('the board', () => {
    it('is built to the declared geometry', () => {
      const built = openingBoard(new SimulationStream(7), game, tables);
      expect(built).toHaveLength(game.rows);
      for (const row of built) expect(row).toHaveLength(game.reels);
    });

    it('never places more than one scatter on a reel', () => {
      const stream = new SimulationStream(3);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const built = openingBoard(stream, game, tables);
        const perReel = new Array(game.reels).fill(0);
        for (const [, reel] of positionsOf(built, 'SIGIL')) perReel[reel] += 1;
        expect(Math.max(...perReel)).toBeLessThanOrEqual(1);
      }
    });

    it('only ever holds symbols the definition declares', () => {
      const declared = new Set(game.symbols.map((symbol) => symbol.id));
      const stream = new SimulationStream(11);
      for (let attempt = 0; attempt < 80; attempt += 1) {
        for (const row of openingBoard(stream, game, tables)) {
          for (const cell of row) {
            expect(declared.has(cell.symbol)).toBe(true);
            if (cell.symbol === 'ORB') {
              expect(game.orbFaces.some((face) => face.value === cell.orbValue)).toBe(true);
            } else {
              expect(cell.orbValue).toBeUndefined();
            }
          }
        }
      }
    });
  });

  describe('paying anywhere', () => {
    it('pays nothing below the minimum cluster', () => {
      expect(bandFor(game, 'CROWN', game.minCluster - 1)).toBeNull();
      expect(bandFor(game, 'CROWN', 0)).toBeNull();
    });

    it('reads the highest band a count reaches', () => {
      expect(bandFor(game, 'CROWN', 8)).toBe(350);
      expect(bandFor(game, 'CROWN', 9)).toBe(350);
      expect(bandFor(game, 'CROWN', 10)).toBe(900);
      expect(bandFor(game, 'CROWN', 11)).toBe(900);
      expect(bandFor(game, 'CROWN', 12)).toBe(1_800);
      // Everything above the top band keeps paying that band.
      expect(bandFor(game, 'CROWN', 30)).toBe(1_800);
    });

    it('counts copies anywhere on the board, not along a line', () => {
      // Eight azure gems scattered across every reel and row.
      const rows = [
        ['GEM_AZURE', 'CROWN', 'GEM_AZURE', 'CROWN', 'GEM_AZURE', 'CROWN'],
        ['CROWN', 'GEM_AZURE', 'CROWN', 'GEM_AZURE', 'CROWN', 'GEM_AZURE'],
        ['GEM_ROSE', 'GEM_AZURE', 'GEM_AZURE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
        ['GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
        ['GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
      ];
      const wins = evaluateBoard(game, board(rows));
      const azure = wins.find((win) => win.symbolId === 'GEM_AZURE');
      expect(azure).toEqual({ symbolId: 'GEM_AZURE', count: 8, centi: 9 });
      // Six crowns is below the minimum and pays nothing, while the roses do.
      expect(wins.some((win) => win.symbolId === 'CROWN')).toBe(false);
      expect(wins.find((win) => win.symbolId === 'GEM_ROSE')?.count).toBe(16);
    });

    it('pays every qualifying symbol on the same board', () => {
      const rows = [
        ['CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN'],
        ['CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN'],
        ['GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
        ['GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'SIGIL', 'SIGIL', 'ORB'],
        ['GEM_AZURE', 'GEM_AZURE', 'GEM_AZURE', 'GEM_AZURE', 'GEM_AZURE', 'GEM_AZURE'],
      ];
      const wins = evaluateBoard(game, board(rows));
      expect(wins.map((win) => win.symbolId).sort()).toEqual(['CROWN', 'GEM_ROSE']);
      // Six azure gems do not reach the minimum, and scatters and orbs never pay.
      expect(wins.some((win) => ['SIGIL', 'ORB', 'GEM_AZURE'].includes(win.symbolId))).toBe(false);
    });
  });

  describe('tumbling', () => {
    it('drops survivors to the floor and refills only above them', () => {
      const rows = [
        ['CROWN', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
        ['CROWN', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
        ['GEM_AZURE', 'CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN'],
        ['GEM_AZURE', 'CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN'],
        ['SIGIL', 'GEM_AZURE', 'GEM_AZURE', 'GEM_AZURE', 'GEM_AZURE', 'GEM_AZURE'],
      ];
      const before = board(rows);
      const after = clearAndDrop(azureFill, game, tables, before, new Set(['CROWN']));

      // Reel 0 kept three survivors, which settled on the floor in order.
      expect(after[4][0].symbol).toBe('SIGIL');
      expect(after[3][0].symbol).toBe('GEM_AZURE');
      expect(after[2][0].symbol).toBe('GEM_AZURE');
      // Reel 1 kept three survivors too: two roses and the azure gem.
      expect(after[4][1].symbol).toBe('GEM_AZURE');
      expect(after[3][1].symbol).toBe('GEM_ROSE');
      expect(after[2][1].symbol).toBe('GEM_ROSE');
      // No crown survived anywhere.
      expect(positionsOf(after, 'CROWN')).toHaveLength(0);
      // The board is still full.
      for (const row of after) {
        expect(row).toHaveLength(game.reels);
        for (const cell of row) expect(cell.symbol).toBeTruthy();
      }
    });

    it('never clears a scatter or an orb', () => {
      const rows = [
        ['CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN'],
        ['CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN'],
        ['SIGIL', 'CROWN', 'CROWN', 'CROWN', 'CROWN', 'CROWN'],
        ['GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
        ['GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE', 'GEM_ROSE'],
      ];
      const before = board(rows);
      before[2][1] = { symbol: 'ORB', orbValue: 25 };
      const after = clearAndDrop(azureFill, game, tables, before, new Set(['CROWN']));
      expect(positionsOf(after, 'SIGIL')).toHaveLength(1);
      const orb = after.flat().find((cell) => cell.symbol === 'ORB');
      expect(orb?.orbValue).toBe(25);
    });
  });

  describe('a spin', () => {
    it('always ends on a board that pays nothing, or at the structural ceiling', () => {
      const stream = new SimulationStream(5);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        const { spin } = playSpin(stream, game, tables, 0);
        expect(spin.steps.length).toBeGreaterThanOrEqual(1);
        expect(spin.steps.length).toBeLessThanOrEqual(game.maxTumbles + 1);
        const last = spin.steps[spin.steps.length - 1];
        if (spin.steps.length <= game.maxTumbles) expect(last.wins).toHaveLength(0);
        // The raw total is exactly what the steps paid.
        expect(spin.rawCenti).toBe(spin.steps.reduce((sum, step) => sum + step.winCenti, 0));
      }
    });

    it('pays at face value with no orbs, and at the orb total with them', () => {
      const stream = new SimulationStream(13);
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const { spin } = playSpin(stream, game, tables, 0);
        expect(spin.appliedMultiplier).toBe(spin.orbTotal > 0 ? spin.orbTotal : 1);
        expect(spin.winCenti).toBe(spin.rawCenti * spin.appliedMultiplier + spin.scatterCenti);
        // An orb on a board that paid nothing is worth nothing.
        if (spin.rawCenti === 0) expect(spin.winCenti).toBe(spin.scatterCenti);
      }
    });

    it('carries the session multiplier into the applied multiplier', () => {
      const stream = new SimulationStream(21);
      const { spin, carry } = playSpin(stream, game, tables, 40);
      expect(carry).toBe(40 + spin.orbTotal);
      expect(spin.appliedMultiplier).toBe(40 + spin.orbTotal);
    });

    it('encodes every board as one character per cell', () => {
      const codes = new Set(game.symbols.map((symbol) => symbol.code));
      const { spin } = playSpin(new SimulationStream(31), game, tables, 0);
      for (const step of spin.steps) {
        expect(step.rows).toHaveLength(game.rows);
        for (const row of step.rows) {
          expect(row).toHaveLength(game.reels);
          for (const character of row) expect(codes.has(character)).toBe(true);
        }
        // Orbs are listed exactly where the encoded board says they are.
        const encodedOrbs = step.rows
          .flatMap((row, rowIndex) => [...row]
            .map((character, reel) => (character === 'O' ? `${rowIndex}:${reel}` : null))
            .filter((entry): entry is string => entry !== null));
        expect(step.orbs.map((orb) => `${orb.row}:${orb.reel}`).sort())
          .toEqual(encodedOrbs.sort());
      }
    });

    it('pays the scatter band a count reaches, and nothing below the lowest', () => {
      expect(scatterCentiFor(game, 3)).toBe(0);
      expect(scatterCentiFor(game, 4)).toBe(100);
      expect(scatterCentiFor(game, 5)).toBe(175);
      expect(scatterCentiFor(game, 6)).toBe(3_500);
    });
  });

  describe('the free spin session', () => {
    it('never shrinks its multiplier and reports it per spin', () => {
      const stream = new SimulationStream(41);
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const feature = playFeature(stream, game, tables);
        expect(feature.spins).toHaveLength(feature.multiplierAfter.length);
        let previous = 0;
        for (const [index, value] of feature.multiplierAfter.entries()) {
          expect(value).toBeGreaterThanOrEqual(previous);
          expect(value).toBe(previous + feature.spins[index].orbTotal);
          previous = value;
        }
        expect(feature.totalCenti)
          .toBe(feature.spins.reduce((sum, spin) => sum + spin.winCenti, 0));
      }
    });

    it('plays the award plus every retrigger, and always terminates', () => {
      const stream = new SimulationStream(53);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const feature = playFeature(stream, game, tables);
        const extra = feature.retriggers.length * game.freeSpins.retriggerAward;
        expect(feature.awarded).toBe(game.freeSpins.award + extra);
        expect(feature.spins.length).toBeLessThanOrEqual(game.freeSpins.maxSpins);
        if (!feature.truncated) expect(feature.spins).toHaveLength(feature.awarded);
        for (const retrigger of feature.retriggers) {
          expect(feature.spins[retrigger.spinIndex].scatterCount)
            .toBeGreaterThanOrEqual(game.freeSpins.retrigger);
        }
      }
    });
  });

  describe('a round', () => {
    it('is reproducible from its fairness inputs alone', () => {
      const input = fairness();
      const first = resolveTumbleRound(input, game, 'BASE');
      const second = resolveTumbleRound(input, game, 'BASE');
      expect(second).toEqual(first);
    });

    it('changes completely when any fairness input changes', () => {
      const baseline = JSON.stringify(resolveTumbleRound(fairness(), game, 'BASE'));
      expect(JSON.stringify(resolveTumbleRound(fairness({ nonce: 1 }), game, 'BASE')))
        .not.toBe(baseline);
      expect(JSON.stringify(resolveTumbleRound(fairness({ clientSeed: 'other' }), game, 'BASE')))
        .not.toBe(baseline);
      expect(JSON.stringify(resolveTumbleRound(fairness({ serverSeed: 'b'.repeat(64) }), game, 'BASE')))
        .not.toBe(baseline);
    });

    it('separates games and versions in the fairness domain', () => {
      expect(tumbleDomain(game, tumbleVersion(game)))
        .toBe(`casino:tumble:titans-tempest:titans-tempest.v1.rtp${game.declaredRtpBps}`);
      // A different family with the same id could never share a byte stream.
      expect(tumbleDomain(game, 'other')).not.toBe(tumbleDomain(game, tumbleVersion(game)));
    });

    it('opens the feature exactly when the opening drop shows enough scatters', () => {
      for (let nonce = 0; nonce < 60; nonce += 1) {
        const round = resolveTumbleRound(fairness({ nonce }), game, 'BASE');
        const triggered = round.base!.scatterCount >= game.freeSpins.trigger;
        expect(round.feature !== null).toBe(triggered);
      }
    });

    it('skips the paid spin and always runs the feature when it is bought', () => {
      for (let nonce = 0; nonce < 6; nonce += 1) {
        const round = resolveTumbleRound(fairness({ nonce }), game, 'BUY_FEATURE');
        expect(round.base).toBeNull();
        expect(round.feature).not.toBeNull();
        expect(round.feature!.spins.length).toBeGreaterThanOrEqual(game.freeSpins.award);
        expect(round.totalCenti).toBe(Math.min(round.feature!.totalCenti, game.maxWinCenti));
      }
    });

    it('applies the structural cap and says so', () => {
      const tiny: TumbleGameDefinition = { ...game, maxWinCenti: maxBoardCenti(game) + 1 };
      let sawCap = false;
      for (let nonce = 0; nonce < 20 && !sawCap; nonce += 1) {
        const round = resolveTumbleRound(fairness({ nonce }), tiny, 'BUY_FEATURE');
        if (round.capped) {
          sawCap = true;
          expect(round.totalCenti).toBe(tiny.maxWinCenti);
        }
        expect(round.totalCenti).toBeLessThanOrEqual(tiny.maxWinCenti);
      }
      expect(sawCap).toBe(true);
    });
  });

  describe('money arithmetic', () => {
    it('charges one bet for a spin and the published price for the feature', () => {
      expect(tumbleCharge(game, 100n, 'BASE')).toBe(100n);
      expect(tumbleCharge(game, 100n, 'BUY_FEATURE')).toBe(9_000n);
      // A price that does not divide the bet rounds up, never down, so the
      // house can never be undercharged by a rounding rule.
      const odd: TumbleGameDefinition = { ...game, buyFeatureCenti: 150 };
      expect(tumbleCharge(odd, 1n, 'BUY_FEATURE')).toBe(2n);
      expect(tumbleCharge(odd, 2n, 'BUY_FEATURE')).toBe(3n);
    });

    it('floors the payout exactly once, at the end', () => {
      expect(tumblePayout(100n, 0)).toBe(0n);
      expect(tumblePayout(100n, 100)).toBe(100n);
      expect(tumblePayout(7n, 150)).toBe(10n); // 7 * 1.5 = 10.5 -> 10
      expect(tumblePayout(1n, 99)).toBe(0n);
      // Large stakes stay exact: nothing here is a double.
      expect(tumblePayout(1_000_000_000_000n, 1_500_000)).toBe(15_000_000_000_000_000n);
    });

    it('formats the display multiplier straight from the integer', () => {
      expect(totalMultiplier(0)).toBe('0.00');
      expect(totalMultiplier(5)).toBe('0.05');
      expect(totalMultiplier(100)).toBe('1.00');
      expect(totalMultiplier(123_456)).toBe('1234.56');
    });
  });

  describe('the simulated return', () => {
    it('draws uniformly, so a measured figure is not a residue artefact', () => {
      const stream = new SimulationStream(99);
      const bound = 7;
      const counts = new Array(bound).fill(0);
      const draws = 210_000;
      for (let draw = 0; draw < draws; draw += 1) counts[stream.nextBelow(bound)] += 1;
      const expected = draws / bound;
      for (const count of counts) {
        expect(Math.abs(count - expected) / expected).toBeLessThan(0.02);
      }
      expect(stream.nextBelow(1)).toBe(0);
      expect(() => stream.nextBelow(0)).toThrow(RangeError);
    });

    it('reproduces an exact golden figure, so the definition cannot drift unnoticed', () => {
      // The simulation source is a deterministic integer PRNG, so a fixed seed
      // and round count produce one exact figure on every machine. Any change
      // to a weight, a band, an orb face or the feature moves it, which is what
      // makes this a real guard at a round count a test suite can afford.
      const measured = simulateTumbleRtp(game, { rounds: 8_000, mode: 'BASE', seed: 20_260_918 });
      expect(measured.returnedCenti).toBe(711_689);
      expect(measured.rtpBps).toBe(8_896);

      const bought = simulateTumbleRtp(game, {
        rounds: 1_500,
        mode: 'BUY_FEATURE',
        seed: 20_260_919,
      });
      expect(bought.returnedCenti).toBe(12_993_377);
      expect(bought.rtpBps).toBe(9_625);
    });

    it('lands near the declared return, and prices the feature close to it', () => {
      // A sanity band, not a certification: at this many rounds the sampling
      // error is large, because almost all of the return arrives through a
      // feature that opens about once in two hundred spins. The measurement
      // behind the declared figure is documented in the definition; 6,000,000
      // rounds put it at 9514bps with a seed-to-seed spread of about 90bps.
      const measured = simulateTumbleRtp(game, { rounds: 8_000, mode: 'BASE', seed: 20_260_918 });
      expect(Math.abs(measured.rtpBps - game.declaredRtpBps)).toBeLessThan(3_000);
      expect(measured.hitRate).toBeGreaterThan(0.25);
      expect(measured.hitRate).toBeLessThan(0.45);
      expect(measured.featureRate).toBeGreaterThan(0.001);
      expect(measured.featureRate).toBeLessThan(0.02);

      // Buying must not be a materially worse deal than waiting for the feature.
      const bought = simulateTumbleRtp(game, {
        rounds: 1_500,
        mode: 'BUY_FEATURE',
        seed: 20_260_919,
      });
      expect(Math.abs(bought.rtpBps - game.declaredRtpBps)).toBeLessThan(3_000);
    });
  });
});
