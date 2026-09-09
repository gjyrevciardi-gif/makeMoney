import { Prisma } from '@prisma/client';
import { casinoConfig } from '../src/casino/casino.config';
import { FairnessInput } from '../src/casino/casino-fairness.service';
import {
  ROULETTE_BET_TYPES,
  RouletteBetType,
  isBlack,
  isRed,
  pocketColour,
  rouletteExpectedReturn,
  rouletteReturnNumerator,
  rouletteMultiplier,
  rouletteSpin,
  rouletteWinningPockets,
  rouletteWins,
} from '../src/casino/games/roulette/roulette.engine';
import {
  blackjackPayout,
  cardRank,
  handValue,
  isNaturalBlackjack,
  playDealer,
  settleHand,
  shuffleShoe,
} from '../src/casino/games/blackjack/blackjack.engine';

describe('table game mathematics', () => {
  const fairness = (overrides: Partial<FairnessInput> = {}): FairnessInput => ({
    serverSeed: 'c'.repeat(64),
    domain: 'casino:test:v1',
    clientSeed: 'client',
    nonce: 0,
    ...overrides,
  });

  describe('european roulette', () => {
    const config = () => casinoConfig().roulette;

    it('uses a 37 pocket single-zero wheel', () => {
      expect(config().pockets).toBe(37);
      expect(config().rtpBps).toBe(9_730);
      expect(config().houseEdgeBps).toBe(270);
    });

    it('colours the wheel canonically with exactly 18 red and 18 black', () => {
      const reds = Array.from({ length: 37 }, (_, pocket) => pocket).filter(isRed);
      const blacks = Array.from({ length: 37 }, (_, pocket) => pocket).filter(isBlack);
      expect(reds).toHaveLength(18);
      expect(blacks).toHaveLength(18);
      expect(pocketColour(0)).toBe('GREEN');
      expect(pocketColour(1)).toBe('RED');
      expect(pocketColour(2)).toBe('BLACK');
      expect(reds.some((pocket) => blacks.includes(pocket))).toBe(false);
    });

    it('pays the canonical multipliers', () => {
      expect(rouletteMultiplier('STRAIGHT')).toBe(36);
      expect(rouletteMultiplier('RED')).toBe(2);
      expect(rouletteMultiplier('ODD')).toBe(2);
      expect(rouletteMultiplier('LOW')).toBe(2);
      expect(rouletteMultiplier('DOZEN_1')).toBe(3);
      expect(rouletteMultiplier('COLUMN_3')).toBe(3);
    });

    it('loses every outside bet on zero', () => {
      const outside = ROULETTE_BET_TYPES.filter((type) => type !== 'STRAIGHT');
      for (const type of outside) {
        expect(rouletteWins(type, 0)).toBe(false);
      }
      expect(rouletteWins('STRAIGHT', 0, 0)).toBe(true);
      expect(rouletteWins('STRAIGHT', 0, 7)).toBe(false);
    });

    it('counts the expected number of winning pockets per bet', () => {
      const expected: Record<string, number> = {
        RED: 18, BLACK: 18, ODD: 18, EVEN: 18, LOW: 18, HIGH: 18,
        DOZEN_1: 12, DOZEN_2: 12, DOZEN_3: 12,
        COLUMN_1: 12, COLUMN_2: 12, COLUMN_3: 12,
      };
      for (const [type, count] of Object.entries(expected)) {
        expect(rouletteWinningPockets(type as RouletteBetType)).toBe(count);
      }
      expect(rouletteWinningPockets('STRAIGHT', 17)).toBe(1);
    });

    it('returns exactly 36/37 in expectation for every supported bet', () => {
      const canonical = new Prisma.Decimal(36).div(37);
      for (const type of ROULETTE_BET_TYPES) {
        const straight = type === 'STRAIGHT' ? 17 : undefined;
        // The exact integer identity: winning pockets * multiplier === 36, so
        // every canonical bet carries the same 1/37 edge and nothing else.
        expect(rouletteReturnNumerator(type, straight)).toBe(36);
        expect(rouletteExpectedReturn(type, straight).equals(canonical)).toBe(true);
      }
    });

    it('assigns dozens and columns without gaps or overlaps', () => {
      for (let pocket = 1; pocket <= 36; pocket += 1) {
        const dozens = (['DOZEN_1', 'DOZEN_2', 'DOZEN_3'] as const)
          .filter((type) => rouletteWins(type, pocket));
        const columns = (['COLUMN_1', 'COLUMN_2', 'COLUMN_3'] as const)
          .filter((type) => rouletteWins(type, pocket));
        expect(dozens).toHaveLength(1);
        expect(columns).toHaveLength(1);
        expect(rouletteWins('LOW', pocket) !== rouletteWins('HIGH', pocket)).toBe(true);
        expect(rouletteWins('ODD', pocket) !== rouletteWins('EVEN', pocket)).toBe(true);
        expect(rouletteWins('RED', pocket) !== rouletteWins('BLACK', pocket)).toBe(true);
      }
    });

    it('spins only inside the wheel and reproduces from identical inputs', () => {
      const current = config();
      for (let nonce = 0; nonce < 200; nonce += 1) {
        const pocket = rouletteSpin(fairness({ nonce }), current);
        expect(pocket).toBeGreaterThanOrEqual(0);
        expect(pocket).toBeLessThanOrEqual(36);
      }
      expect(rouletteSpin(fairness(), current)).toBe(rouletteSpin(fairness(), current));
    });
  });

  describe('blackjack', () => {
    const config = () => casinoConfig().blackjack;
    // Rank offsets inside a deck: 0 = Ace, 9 = Ten, 10..12 = J/Q/K.
    const card = (rank: number, deck = 0) => deck * 52 + rank;

    it('publishes the intended rule set', () => {
      const current = config();
      expect(current.decks).toBe(6);
      expect(current.dealerStandsOnSoft17).toBe(true);
      expect(current.blackjackPayoutNumerator).toBe(3);
      expect(current.blackjackPayoutDenominator).toBe(2);
      expect(current.version).toBe('blackjack.v1.6d.s17.bj3-2');
    });

    it('values ranks correctly', () => {
      expect(cardRank(card(0))).toBe(0);
      expect(handValue([card(9)]).total).toBe(10);
      expect(handValue([card(10)]).total).toBe(10);
      expect(handValue([card(12)]).total).toBe(10);
      expect(handValue([card(1)]).total).toBe(2);
      expect(handValue([card(8)]).total).toBe(9);
    });

    it('counts a single ace as eleven until it would bust', () => {
      expect(handValue([card(0), card(5)])).toEqual({ total: 17, soft: true });
      expect(handValue([card(0), card(5), card(9)])).toEqual({ total: 17, soft: false });
      expect(handValue([card(0), card(9)])).toEqual({ total: 21, soft: true });
    });

    it('reduces multiple aces one at a time', () => {
      expect(handValue([card(0), card(0)])).toEqual({ total: 12, soft: true });
      expect(handValue([card(0), card(0), card(0)])).toEqual({ total: 13, soft: true });
      expect(handValue([card(0), card(0), card(8)])).toEqual({ total: 21, soft: true });
      expect(handValue([card(0), card(0), card(9), card(9)]))
        .toEqual({ total: 22, soft: false });
    });

    it('recognises a natural only on the first two cards', () => {
      expect(isNaturalBlackjack([card(0), card(12)])).toBe(true);
      expect(isNaturalBlackjack([card(0), card(9)])).toBe(true);
      expect(isNaturalBlackjack([card(6), card(6), card(6)])).toBe(false);
    });

    it('stands the dealer on all seventeens including soft', () => {
      const current = config();
      const shoe = [card(9), card(9), card(9)];
      // Hard 17 stands.
      expect(playDealer(shoe, [card(9), card(6)], 0, current).cards).toHaveLength(2);
      // Soft 17 (A+6) also stands under S17.
      expect(playDealer(shoe, [card(0), card(5)], 0, current).cards).toHaveLength(2);
      // 16 must draw.
      expect(playDealer(shoe, [card(9), card(5)], 0, current).cards.length)
        .toBeGreaterThan(2);
    });

    it('settles every canonical outcome with the right total return', () => {
      const current = config();
      const natural = settleHand([card(0), card(12)], [card(9), card(8)], current);
      expect(natural.outcome).toBe('PLAYER_BLACKJACK');
      expect(blackjackPayout(100n, natural.returnNumerator, natural.returnDenominator))
        .toBe(250n);

      const win = settleHand([card(9), card(9)], [card(9), card(7)], current);
      expect(win.outcome).toBe('PLAYER_WIN');
      expect(blackjackPayout(100n, win.returnNumerator, win.returnDenominator)).toBe(200n);

      const push = settleHand([card(9), card(9)], [card(9), card(9)], current);
      expect(push.outcome).toBe('PUSH');
      expect(blackjackPayout(100n, push.returnNumerator, push.returnDenominator)).toBe(100n);

      const loss = settleHand([card(9), card(7)], [card(9), card(9)], current);
      expect(loss.outcome).toBe('DEALER_WIN');
      expect(blackjackPayout(100n, loss.returnNumerator, loss.returnDenominator)).toBe(0n);

      const bust = settleHand([card(9), card(9), card(9)], [card(9), card(7)], current);
      expect(bust.outcome).toBe('PLAYER_BUST');
      expect(blackjackPayout(100n, bust.returnNumerator, bust.returnDenominator)).toBe(0n);

      const dealerBust = settleHand([card(9), card(7)], [card(9), card(9), card(9)], current);
      expect(dealerBust.outcome).toBe('DEALER_BUST');
      expect(blackjackPayout(100n, dealerBust.returnNumerator, dealerBust.returnDenominator))
        .toBe(200n);
    });

    it('pushes when both sides hold a natural and beats a non-natural 21', () => {
      const current = config();
      expect(settleHand([card(0), card(12)], [card(0), card(12)], current).outcome)
        .toBe('PUSH');
      // A drawn 21 does not beat a natural.
      expect(settleHand([card(6), card(6), card(6)], [card(0), card(12)], current).outcome)
        .toBe('DEALER_WIN');
    });

    it('shuffles a complete six-deck shoe deterministically', () => {
      const current = config();
      const shoe = shuffleShoe(fairness(), current);
      expect(shoe).toHaveLength(312);
      expect(new Set(shoe).size).toBe(312);
      expect(Math.min(...shoe)).toBe(0);
      expect(Math.max(...shoe)).toBe(311);
      expect(shuffleShoe(fairness(), current)).toEqual(shoe);
      expect(shuffleShoe(fairness({ nonce: 1 }), current)).not.toEqual(shoe);

      // Each physical card appears exactly six times across the shoe.
      const counts = new Map<number, number>();
      for (const item of shoe) {
        counts.set(item % 52, (counts.get(item % 52) ?? 0) + 1);
      }
      expect(counts.size).toBe(52);
      expect([...counts.values()].every((count) => count === 6)).toBe(true);
    });
  });
});
