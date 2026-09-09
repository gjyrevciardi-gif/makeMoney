import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CasinoFairnessService } from '../src/casino/casino-fairness.service';
import { CasinoRoundService } from '../src/casino/casino-round.service';
import { CasinoConfigService } from '../src/casino/casino-config.service';
import { CasinoGameRegistry } from '../src/casino/casino-game.registry';

import { BlackjackService } from '../src/casino/games/blackjack/blackjack.service';
import { RouletteService } from '../src/casino/games/roulette/roulette.service';
import { PlayRouletteDto } from '../src/casino/games/roulette/roulette.dto';
import { handValue, isNaturalBlackjack } from '../src/casino/games/blackjack/blackjack.engine';
import { PrismaService } from '../src/prisma.service';
import { PointsService } from '../src/wallet/points.service';

describe('roulette and blackjack (PostgreSQL)', () => {
  const prisma = new PrismaService();
  const fairness = new CasinoFairnessService();
  const rounds = new CasinoRoundService(prisma, fairness);
  const configs = new CasinoConfigService(prisma, new CasinoGameRegistry());
  const roulette = new RouletteService(rounds, configs);
  const blackjack = new BlackjackService(prisma, rounds, configs);
  const points = new PointsService(prisma);
  let userId: string;
  let otherId: string;
  let adminId: string;

  const spin = (overrides: Partial<PlayRouletteDto> = {}): PlayRouletteDto => ({
    bets: [{ type: 'RED', amount: 100 }],
    idempotencyKey: randomUUID(),
    ...overrides,
  });

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CasinoGameConfigVersion", "CasinoGameConfig", "PlatformSettings", "CasinoTransaction", "CasinoRoundAction", "CasinoRound", "CasinoGameFavorite", "LedgerEntry", "BetLeg", "Bet", "AuditLog", "RefreshToken", "Wallet", "User" CASCADE',
    );
    const user = await prisma.user.create({
      data: { email: 'table-player@example.test', passwordHash: 'x', wallet: { create: {} } },
    });
    const other = await prisma.user.create({
      data: { email: 'table-other@example.test', passwordHash: 'x', wallet: { create: {} } },
    });
    const admin = await prisma.user.create({
      data: { email: 'table-admin@example.test', passwordHash: 'x', role: 'ADMIN', wallet: { create: {} } },
    });
    userId = user.id;
    otherId = other.id;
    adminId = admin.id;
  });

  const fund = (target = userId, amount = 100_000n) =>
    points.adminGrant(adminId, target, amount, 'Table game funding', randomUUID());
  const balance = async (target = userId) =>
    (await prisma.wallet.findUniqueOrThrow({ where: { userId: target } })).balance;
  const ledgerTotal = async (target = userId) => {
    const entries = await prisma.ledgerEntry.findMany({ where: { wallet: { userId: target } } });
    return entries.reduce((sum, entry) => sum + entry.amount, 0n);
  };

  describe('roulette', () => {
    it('settles a spin against one authoritative pocket and debits the total stake once', async () => {
      await fund();
      const result = await roulette.play(userId, spin({
        bets: [
          { type: 'RED', amount: 100 },
          { type: 'DOZEN_1', amount: 50 },
          { type: 'STRAIGHT', amount: 10, number: 17 },
        ],
      }));

      const state = result.state as {
        pocket: number;
        colour: string;
        bets: { type: string; won: boolean; payout: string; multiplier: number }[];
        totalStake: string;
      };
      expect(state.pocket).toBeGreaterThanOrEqual(0);
      expect(state.pocket).toBeLessThanOrEqual(36);
      expect(state.totalStake).toBe('160');
      expect(result.stake).toBe('160');
      expect(state.bets).toHaveLength(3);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
      expect(await balance()).toBe(100_000n - 160n + BigInt(result.payout));
      expect(await ledgerTotal()).toBe(await balance());
    });

    it('pays each winning bet its canonical multiplier and nothing to the losers', async () => {
      await fund();
      const result = await roulette.play(userId, spin({
        bets: [
          { type: 'RED', amount: 100 },
          { type: 'BLACK', amount: 100 },
        ],
      }));
      const state = result.state as {
        pocket: number;
        bets: { type: string; won: boolean; payout: string }[];
      };
      // Red and black are complementary: zero loses both, otherwise exactly one wins.
      const winners = state.bets.filter((bet) => bet.won);
      expect(winners).toHaveLength(state.pocket === 0 ? 0 : 1);
      expect(result.payout).toBe(state.pocket === 0 ? '0' : '200');
      for (const bet of state.bets) {
        expect(bet.payout).toBe(bet.won ? '200' : '0');
      }
    });

    it('credits a winning spin exactly once', async () => {
      await fund();
      let winner: Awaited<ReturnType<RouletteService['play']>> | undefined;
      for (let attempt = 0; attempt < 40 && !winner; attempt += 1) {
        // Backing every dozen wins on any non-zero pocket.
        const result = await roulette.play(userId, spin({
          bets: [
            { type: 'DOZEN_1', amount: 10 },
            { type: 'DOZEN_2', amount: 10 },
            { type: 'DOZEN_3', amount: 10 },
          ],
        }));
        if (result.status === 'WON') winner = result;
      }
      expect(winner).toBeDefined();
      // One dozen returns 3x its 10 point stake against a 30 point total.
      expect(winner!.payout).toBe('30');
      expect(
        await prisma.ledgerEntry.count({
          where: { type: 'CASINO_WIN', relatedCasinoRoundId: winner!.roundId },
        }),
      ).toBe(1);
      expect(await ledgerTotal()).toBe(await balance());
    });

    it.each([
      ['a straight bet with no number', { bets: [{ type: 'STRAIGHT' as const, amount: 10 }] }],
      ['a number on an outside bet', { bets: [{ type: 'RED' as const, amount: 10, number: 5 }] }],
      ['duplicate bets', { bets: [{ type: 'RED' as const, amount: 10 }, { type: 'RED' as const, amount: 20 }] }],
    ])('rejects %s', async (_label, overrides) => {
      await fund();
      await expect(roulette.play(userId, spin(overrides))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it('checks the combined stake against the maximum, not each bet alone', async () => {
      await fund();
      await expect(roulette.play(userId, spin({
        bets: [
          { type: 'RED', amount: 600_000 },
          { type: 'BLACK', amount: 600_000 },
        ],
      }))).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'STAKE_ABOVE_MAXIMUM' }),
      });
      expect(await prisma.casinoRound.count()).toBe(0);
    });

    it('refuses a spin the wallet cannot cover', async () => {
      await expect(roulette.play(userId, spin())).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.casinoRound.count()).toBe(0);
      expect(await prisma.ledgerEntry.count()).toBe(0);
    });

    it('replays a duplicate idempotency key without spinning again', async () => {
      await fund();
      const payload = spin();
      const first = await roulette.play(userId, payload);
      const second = await roulette.play(userId, payload);
      expect(second.roundId).toBe(first.roundId);
      expect(second.state).toEqual(first.state);
      expect(await prisma.casinoRound.count()).toBe(1);
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    });

    it('keeps concurrent spins inside the balance', async () => {
      await points.adminGrant(adminId, userId, 1_000n, 'Small funding', randomUUID());
      // A winning spin credits back mid-flight, so the number of accepted
      // spins is not fixed. What must always hold is that the wallet never
      // goes negative and still equals the sum of its immutable ledger.
      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () => roulette.play(userId, spin({
          bets: [{ type: 'RED', amount: 400 }],
        }))),
      );
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled').length)
        .toBeGreaterThan(0);
      expect(await balance()).toBeGreaterThanOrEqual(0n);
      expect(await ledgerTotal()).toBe(await balance());
      for (const round of await prisma.casinoRound.findMany()) {
        expect(round.payout).toBeGreaterThanOrEqual(0n);
      }
    });
  });

  describe('blackjack', () => {
    const startHand = async (stake = 100) => blackjack.start(userId, {
      stake,
      idempotencyKey: randomUUID(),
    });
    const hiddenDealer = async (roundId: string) => {
      const round = await prisma.casinoRound.findUniqueOrThrow({ where: { id: roundId } });
      return (round.privateState as unknown as { dealerCards: number[] }).dealerCards;
    };

    it('deals two cards each and hides the hole card while the hand is live', async () => {
      await fund();
      const hand = await startHand();

      expect(hand.hand.playerCards).toHaveLength(2);
      if (hand.status === 'OPEN') {
        expect(hand.hand.dealerCards).toHaveLength(1);
        expect(hand.hand.dealerHoleHidden).toBe(true);
        const serialized = JSON.stringify(hand);
        expect(serialized).not.toContain('shoe');
        expect(hand.fairness).not.toHaveProperty('serverSeed');
        // The dealer's second card exists server-side but is not projected.
        expect(await hiddenDealer(hand.roundId)).toHaveLength(2);
      }
      expect(await prisma.ledgerEntry.count({ where: { type: 'CASINO_BET' } })).toBe(1);
    });

    it('settles immediately when a natural is dealt', async () => {
      await fund();
      let natural: Awaited<ReturnType<BlackjackService['start']>> | undefined;
      for (let attempt = 0; attempt < 200 && !natural; attempt += 1) {
        const hand = await startHand(10);
        if (hand.status !== 'OPEN') natural = hand;
        else await blackjack.stand(userId, hand.roundId, { idempotencyKey: randomUUID() });
      }
      expect(natural).toBeDefined();
      expect(natural!.hand.dealerHoleHidden).toBe(false);
      expect(['PLAYER_BLACKJACK', 'DEALER_WIN', 'PUSH']).toContain(natural!.hand.outcome);
      if (natural!.hand.outcome === 'PLAYER_BLACKJACK') {
        // 3:2 means a 2.5x total return.
        expect(natural!.payout).toBe('25');
        expect(natural!.multiplier).toBe('2.5');
      }
    });

    it('draws a card on hit and finishes the hand on stand', async () => {
      await fund();
      let hand = await startHand();
      while (hand.status !== 'OPEN') hand = await startHand();

      const before = hand.hand.playerCards.length;
      const afterHit = await blackjack.hit(userId, hand.roundId, {
        idempotencyKey: randomUUID(),
      });
      expect(afterHit.hand.playerCards.length).toBe(before + 1);

      if (afterHit.status === 'OPEN') {
        const stood = await blackjack.stand(userId, hand.roundId, {
          idempotencyKey: randomUUID(),
        });
        expect(stood.status).not.toBe('OPEN');
        expect(stood.hand.dealerHoleHidden).toBe(false);
        expect(stood.hand.outcome).toBeTruthy();
        // The dealer must have played to a legal standing total.
        const dealerTotal = stood.hand.dealerTotal;
        expect(dealerTotal >= 17 || dealerTotal > 21 || stood.hand.outcome === 'PLAYER_BUST')
          .toBe(true);
      } else {
        expect(afterHit.hand.outcome).toBe('PLAYER_BUST');
        expect(afterHit.payout).toBe('0');
      }
    });

    it('doubles the committed stake, draws exactly one card, and stands', async () => {
      await fund();
      let hand = await startHand(100);
      while (hand.status !== 'OPEN') hand = await startHand(100);

      const doubled = await blackjack.double(userId, hand.roundId, {
        idempotencyKey: randomUUID(),
      });

      expect(doubled.status).not.toBe('OPEN');
      expect(doubled.hand.doubled).toBe(true);
      expect(doubled.hand.playerCards).toHaveLength(3);
      expect(doubled.stake).toBe('200');
      // Two debits for this round: the original stake and the double. Scoped to
      // the round, because an immediately-settled natural may have preceded it.
      expect(
        await prisma.ledgerEntry.count({
          where: { type: 'CASINO_BET', relatedCasinoRoundId: hand.roundId },
        }),
      ).toBe(2);
      expect(await ledgerTotal()).toBe(await balance());
    });

    it('refuses a double after the hand has grown past two cards', async () => {
      await fund();
      let hand = await startHand();
      while (hand.status !== 'OPEN') hand = await startHand();
      const afterHit = await blackjack.hit(userId, hand.roundId, {
        idempotencyKey: randomUUID(),
      });
      if (afterHit.status !== 'OPEN') return; // busted on the hit; nothing to assert

      await expect(
        blackjack.double(userId, hand.roundId, { idempotencyKey: randomUUID() }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DOUBLE_NOT_ALLOWED' }),
      });
    });

    it('replays a retried action instead of drawing twice', async () => {
      await fund();
      let hand = await startHand();
      while (hand.status !== 'OPEN') hand = await startHand();

      const key = randomUUID();
      const first = await blackjack.hit(userId, hand.roundId, { idempotencyKey: key });
      const replay = await blackjack.hit(userId, hand.roundId, { idempotencyKey: key });
      expect(replay.hand.playerCards).toEqual(first.hand.playerCards);
      expect(await prisma.casinoRoundAction.count({ where: { roundId: hand.roundId } })).toBe(1);
    });

    it('settles once when concurrent stands arrive', async () => {
      await fund();
      let hand = await startHand();
      while (hand.status !== 'OPEN') hand = await startHand();

      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          blackjack.stand(userId, hand.roundId, { idempotencyKey: randomUUID() })),
      );
      expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
      const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: hand.roundId } });
      expect(stored.status).not.toBe('OPEN');
      expect(
        await prisma.ledgerEntry.count({
          where: { type: 'CASINO_WIN', relatedCasinoRoundId: hand.roundId },
        }),
      ).toBeLessThanOrEqual(1);
      expect(await ledgerTotal()).toBe(await balance());
    });

    it('restores an open hand after a refresh', async () => {
      await fund();
      let hand = await startHand();
      while (hand.status !== 'OPEN') hand = await startHand();

      const restored = await blackjack.active(userId);
      expect(restored?.roundId).toBe(hand.roundId);
      expect(restored?.hand.dealerHoleHidden).toBe(true);
      expect(JSON.stringify(restored)).not.toContain('shoe');

      await blackjack.stand(userId, hand.roundId, { idempotencyKey: randomUUID() });
      expect(await blackjack.active(userId)).toBeNull();
    });

    it('refuses a second concurrent hand and isolates hands between players', async () => {
      await fund();
      await fund(otherId);
      let hand = await startHand();
      while (hand.status !== 'OPEN') hand = await startHand();

      await expect(startHand()).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ROUND_ALREADY_OPEN' }),
      });
      await expect(
        blackjack.hit(otherId, hand.roundId, { idempotencyKey: randomUUID() }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        blackjack.stand(otherId, hand.roundId, { idempotencyKey: randomUUID() }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(await balance(otherId)).toBe(100_000n);
    });

    it('reveals the shoe and the seed only once the hand is finished', async () => {
      await fund();
      let hand = await startHand();
      while (hand.status !== 'OPEN') hand = await startHand();
      expect(hand.fairness).not.toHaveProperty('serverSeed');

      const settled = await blackjack.stand(userId, hand.roundId, {
        idempotencyKey: randomUUID(),
      });
      expect(settled.fairness).toHaveProperty('serverSeed');
      const revealed = settled.fairness.revealedState as { shoe: number[] };
      expect(revealed.shoe).toHaveLength(312);
      expect(
        fairness.verifyCommitment(settled.fairness.serverSeed!, settled.fairness.serverSeedHash),
      ).toBe(true);
    });

    it('keeps the dealt hand consistent with its reported totals', async () => {
      await fund();
      const hand = await startHand();
      const stored = await prisma.casinoRound.findUniqueOrThrow({ where: { id: hand.roundId } });
      const publicState = stored.publicState as unknown as { playerCards: number[] };
      expect(handValue(publicState.playerCards).total).toBe(hand.hand.playerTotal);
      if (hand.status !== 'OPEN') {
        const dealer = await hiddenDealer(hand.roundId);
        expect(isNaturalBlackjack(publicState.playerCards) || isNaturalBlackjack(dealer))
          .toBe(true);
      }
    });
  });
});
