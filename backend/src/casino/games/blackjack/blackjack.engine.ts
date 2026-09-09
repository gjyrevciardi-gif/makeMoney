import { BlackjackConfig } from '../../casino.config';
import { FairnessInput, FairnessStream } from '../../casino-fairness.service';

/**
 * Blackjack: 6-deck shoe, dealer stands on all 17s, blackjack pays 3:2,
 * double down allowed on the first two cards. Split, insurance, and surrender
 * are deliberately not implemented in this version, and the rule set is
 * recorded in the round's game version.
 *
 * Cards are integers into the shoe. `card % 52` identifies the physical card,
 * from which rank = (card % 52) % 13 with 0 = Ace, 9 = Ten, 10..12 = J/Q/K.
 * The entire shoe is shuffled once from the committed server seed; drawing is
 * simply advancing a cursor, so the deal is fully reproducible by a verifier
 * and cannot be re-rolled mid-hand.
 */

export type BlackjackAction = 'HIT' | 'STAND' | 'DOUBLE';

export type BlackjackOutcome =
  | 'PLAYER_BLACKJACK'
  | 'PLAYER_WIN'
  | 'DEALER_WIN'
  | 'PLAYER_BUST'
  | 'DEALER_BUST'
  | 'PUSH';

export const RANK_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUIT_LABELS = ['S', 'H', 'D', 'C'];

export const cardRank = (card: number) => (card % 52) % 13;
export const cardSuit = (card: number) => Math.floor((card % 52) / 13);

export function cardLabel(card: number) {
  return `${RANK_LABELS[cardRank(card)]}${SUIT_LABELS[cardSuit(card)]}`;
}

/**
 * Hand total with correct ace handling: aces count 11 until that would bust,
 * then drop to 1. `soft` means an ace is still counted as 11.
 */
export function handValue(cards: number[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = cardRank(card);
    if (rank === 0) {
      aces += 1;
      total += 11;
    } else {
      total += Math.min(rank + 1, 10);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

export const isBust = (cards: number[]) => handValue(cards).total > 21;

/** A natural: exactly two cards totalling 21. */
export const isNaturalBlackjack = (cards: number[]) =>
  cards.length === 2 && handValue(cards).total === 21;

export const blackjackDomain = (config: BlackjackConfig) => `casino:blackjack:${config.version}`;

/**
 * Deterministically shuffles a full shoe with Fisher-Yates driven by the
 * fairness stream. The whole order is fixed before the first card is dealt.
 */
export function shuffleShoe(fairness: FairnessInput, config: BlackjackConfig): number[] {
  const size = config.decks * 52;
  const shoe = Array.from({ length: size }, (_, index) => index);
  const stream = new FairnessStream(fairness);
  for (let index = size - 1; index > 0; index -= 1) {
    const choice = stream.nextBelow(index + 1);
    [shoe[index], shoe[choice]] = [shoe[choice], shoe[index]];
  }
  return shoe;
}

/**
 * Plays the dealer's hand to completion under the configured standing rule.
 * Returns the dealer's final cards and the new shoe cursor.
 */
export function playDealer(
  shoe: number[],
  dealerCards: number[],
  cursor: number,
  config: BlackjackConfig,
): { cards: number[]; cursor: number } {
  const cards = [...dealerCards];
  let next = cursor;
  for (;;) {
    const { total, soft } = handValue(cards);
    if (total > 21) break;
    if (total > 17) break;
    if (total === 17 && (config.dealerStandsOnSoft17 || !soft)) break;
    if (next >= shoe.length) break;
    cards.push(shoe[next]);
    next += 1;
  }
  return { cards, cursor: next };
}

/** Settles a completed hand into an outcome and a total-return multiplier. */
export function settleHand(
  playerCards: number[],
  dealerCards: number[],
  config: BlackjackConfig,
): { outcome: BlackjackOutcome; returnNumerator: number; returnDenominator: number } {
  const player = handValue(playerCards).total;
  const dealer = handValue(dealerCards).total;
  const playerNatural = isNaturalBlackjack(playerCards);
  const dealerNatural = isNaturalBlackjack(dealerCards);

  if (playerNatural && dealerNatural) {
    return { outcome: 'PUSH', returnNumerator: 1, returnDenominator: 1 };
  }
  if (playerNatural) {
    // 3:2 profit means a 5/2 total return.
    return {
      outcome: 'PLAYER_BLACKJACK',
      returnNumerator: config.blackjackPayoutNumerator + config.blackjackPayoutDenominator,
      returnDenominator: config.blackjackPayoutDenominator,
    };
  }
  if (dealerNatural) {
    return { outcome: 'DEALER_WIN', returnNumerator: 0, returnDenominator: 1 };
  }
  if (player > 21) {
    return { outcome: 'PLAYER_BUST', returnNumerator: 0, returnDenominator: 1 };
  }
  if (dealer > 21) {
    return { outcome: 'DEALER_BUST', returnNumerator: 2, returnDenominator: 1 };
  }
  if (player > dealer) {
    return { outcome: 'PLAYER_WIN', returnNumerator: 2, returnDenominator: 1 };
  }
  if (player < dealer) {
    return { outcome: 'DEALER_WIN', returnNumerator: 0, returnDenominator: 1 };
  }
  return { outcome: 'PUSH', returnNumerator: 1, returnDenominator: 1 };
}

/** Total return in whole virtual points, floored. */
export function blackjackPayout(
  stake: bigint,
  numerator: number,
  denominator: number,
): bigint {
  if (numerator === 0) return 0n;
  return (stake * BigInt(numerator)) / BigInt(denominator);
}
