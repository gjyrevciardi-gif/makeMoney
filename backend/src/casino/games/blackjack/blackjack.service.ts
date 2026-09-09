import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CasinoRound, CasinoRoundStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { BlackjackConfig, casinoConfig } from '../../casino.config';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoRoundService } from '../../casino-round.service';
import { BlackjackActionDto, StartBlackjackDto } from './blackjack.dto';
import {
  BlackjackOutcome,
  blackjackDomain,
  blackjackPayout,
  cardLabel,
  handValue,
  isBust,
  isNaturalBlackjack,
  playDealer,
  settleHand,
  shuffleShoe,
} from './blackjack.engine';

type BlackjackPublicState = {
  playerCards: number[];
  dealerCards: number[];
  dealerHoleHidden: boolean;
  doubled: boolean;
  outcome: BlackjackOutcome | null;
  baseStake: string;
};

type BlackjackPrivateState = {
  shoe: number[];
  cursor: number;
  dealerCards: number[];
};

/**
 * Server-authoritative blackjack.
 *
 * The shoe is shuffled once from the committed server seed and lives in
 * `privateState`. While the hand is in progress the projection exposes only
 * the dealer's up-card; the hole card and every undealt card stay hidden, and
 * are revealed together with the seed when the round settles.
 */
@Injectable()
export class BlackjackService {
  private readonly logger = new Logger(BlackjackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rounds: CasinoRoundService,
    private readonly configs: CasinoConfigService,
  ) {}

  /**
   * Overlays the operator's versioned rule set. These are real rules the engine
   * already consumes - deck count, the soft-17 rule, the natural payout - not
   * decorative switches, and none of them bias the shuffle.
   */
  private shape(effective: {
    minStake: bigint; maxStake: bigint;
    gameSpecific: Record<string, unknown>; versionLabel: string;
  }): BlackjackConfig {
    const base = casinoConfig().blackjack;
    const integer = (value: unknown, fallback: number) =>
      Number.isInteger(value) ? (value as number) : fallback;
    const boolean = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback;
    return {
      ...base,
      minStake: effective.minStake,
      maxStake: effective.maxStake,
      decks: integer(effective.gameSpecific.decks, base.decks),
      dealerStandsOnSoft17: boolean(
        effective.gameSpecific.dealerStandsOnSoft17,
        base.dealerStandsOnSoft17,
      ),
      blackjackPayoutNumerator: integer(
        effective.gameSpecific.blackjackPayoutNumerator,
        base.blackjackPayoutNumerator,
      ),
      blackjackPayoutDenominator: integer(
        effective.gameSpecific.blackjackPayoutDenominator,
        base.blackjackPayoutDenominator,
      ),
      doubleDownEnabled: boolean(
        effective.gameSpecific.doubleDownEnabled,
        base.doubleDownEnabled,
      ),
      version: effective.versionLabel,
    };
  }

  /** Rules for a NEW hand. */
  private async config(): Promise<BlackjackConfig> {
    return this.shape(await this.configs.effective('blackjack'));
  }

  /** Rules for a hand already dealt, from the version it recorded. */
  private async roundConfig(label: string): Promise<BlackjackConfig> {
    return this.shape(await this.configs.frozen('blackjack', label));
  }

  async publicConfig() {
    const config = await this.config();
    return {
      gameType: config.gameType,
      gameId: config.gameId,
      version: config.version,
      mathVersion: config.mathVersion,
      minStake: config.minStake.toString(),
      maxStake: config.maxStake.toString(),
      decks: config.decks,
      dealerStandsOnSoft17: config.dealerStandsOnSoft17,
      blackjackPayout: `${config.blackjackPayoutNumerator}:${config.blackjackPayoutDenominator}`,
      doubleDownEnabled: config.doubleDownEnabled,
      supportedActions: ['HIT', 'STAND', 'DOUBLE'],
      unsupportedActions: ['SPLIT', 'INSURANCE', 'SURRENDER'],
      note: 'Blackjack return depends on player decisions, so no single theoretical RTP is published.',
    };
  }

  private parsePublic(round: CasinoRound): BlackjackPublicState {
    const state = round.publicState as unknown as BlackjackPublicState;
    if (!state || !Array.isArray(state.playerCards)) {
      throw new ConflictException({ code: 'ROUND_STATE_INVALID', message: 'Round state is unavailable.' });
    }
    return state;
  }

  private parsePrivate(round: CasinoRound): BlackjackPrivateState {
    const state = round.privateState as unknown as BlackjackPrivateState;
    if (!state || !Array.isArray(state.shoe)) {
      throw new ConflictException({ code: 'ROUND_STATE_INVALID', message: 'Round state is unavailable.' });
    }
    return state;
  }

  /** Adds the derived, non-secret hand summary the UI needs. */
  private async view(round: CasinoRound) {
    const base = this.rounds.publicView(round);
    const state = this.parsePublic(round);
    // A dealt hand keeps the rules it was dealt under.
    const config = await this.roundConfig(round.gameVersion);
    const player = handValue(state.playerCards);
    const dealerVisible = handValue(state.dealerCards);
    const open = round.status === 'OPEN';
    return {
      ...base,
      hand: {
        playerCards: state.playerCards.map(cardLabel),
        dealerCards: state.dealerCards.map(cardLabel),
        dealerHoleHidden: state.dealerHoleHidden,
        playerTotal: player.total,
        playerSoft: player.soft,
        dealerTotal: dealerVisible.total,
        doubled: state.doubled,
        outcome: state.outcome,
        canHit: open,
        canStand: open,
        canDouble:
          open
          && config.doubleDownEnabled
          && state.playerCards.length === 2
          && !state.doubled,
      },
    };
  }

  private statusFor(outcome: BlackjackOutcome): CasinoRoundStatus {
    if (outcome === 'PUSH') return 'CASHED_OUT';
    if (outcome === 'PLAYER_BLACKJACK' || outcome === 'PLAYER_WIN' || outcome === 'DEALER_BUST') {
      return 'WON';
    }
    return 'LOST';
  }

  async start(userId: string, input: StartBlackjackDto) {
    await this.configs.assertPlayable('blackjack');
    const config = await this.config();
    const stake = this.rounds.assertStake(input.stake, config as never);

    const existingOpen = await this.prisma.casinoRound.findFirst({
      where: { userId, gameType: 'BLACKJACK', status: 'OPEN' },
    });
    if (existingOpen && existingOpen.idempotencyKey !== input.idempotencyKey) {
      throw new ConflictException({
        code: 'ROUND_ALREADY_OPEN',
        message: 'Finish your current hand first.',
      });
    }

    const prepared = this.rounds.prepare(input.clientSeed, blackjackDomain(config));
    const shoe = shuffleShoe(prepared.fairness, config);
    const playerCards = [shoe[0], shoe[2]];
    const dealerCards = [shoe[1], shoe[3]];
    const cursor = 4;

    // A natural on either side settles the hand immediately.
    const naturalPresent = isNaturalBlackjack(playerCards) || isNaturalBlackjack(dealerCards);
    if (naturalPresent) {
      const settlement = settleHand(playerCards, dealerCards, config);
      const payout = blackjackPayout(
        stake,
        settlement.returnNumerator,
        settlement.returnDenominator,
      );
      const round = await this.rounds.openRound({
        userId,
        gameId: 'blackjack',
        gameType: 'BLACKJACK',
        gameVersion: config.version,
        stake,
        idempotencyKey: input.idempotencyKey,
        prepared,
        reason: 'Casino blackjack stake',
        outcome: {
          status: this.statusFor(settlement.outcome),
          multiplier: new Prisma.Decimal(settlement.returnNumerator)
            .div(settlement.returnDenominator),
          payout,
          publicState: {
            playerCards,
            dealerCards,
            dealerHoleHidden: false,
            doubled: false,
            outcome: settlement.outcome,
            baseStake: stake.toString(),
          },
          privateState: { shoe, cursor, dealerCards },
        },
      });
      return this.view(round);
    }

    const round = await this.rounds.openRound({
      userId,
      gameId: 'blackjack',
      gameType: 'BLACKJACK',
      gameVersion: config.version,
      stake,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: 'Casino blackjack stake',
      outcome: {
        status: 'OPEN',
        multiplier: null,
        payout: 0n,
        publicState: {
          playerCards,
          // Only the up-card is public while the hand is live.
          dealerCards: [dealerCards[0]],
          dealerHoleHidden: true,
          doubled: false,
          outcome: null,
          baseStake: stake.toString(),
        },
        privateState: { shoe, cursor, dealerCards },
      },
    });
    return this.view(round);
  }

  /** The active hand for refresh recovery. */
  async active(userId: string) {
    const round = await this.prisma.casinoRound.findFirst({
      where: { userId, gameType: 'BLACKJACK', status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });
    return round ? this.view(round) : null;
  }

  /**
   * Applies one player action inside a serialised transaction. The recorded
   * action key makes a retry a replay, and the conditional status update means
   * only one concurrent request can settle the hand.
   */
  private async act(
    userId: string,
    roundId: string,
    action: 'HIT' | 'STAND' | 'DOUBLE',
    input: BlackjackActionDto,
  ) {
    const opened = await this.prisma.casinoRound.findFirst({ where: { id: roundId, userId } });
    if (!opened) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    const config = await this.roundConfig(opened.gameVersion);
    const settled = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${roundId}))`;

      const replay = await tx.casinoRoundAction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (replay) {
        if (replay.roundId !== roundId || replay.userId !== userId) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'This request identifier is already in use.' });
        }
        return tx.casinoRound.findFirstOrThrow({ where: { id: roundId, userId } });
      }

      const round = await tx.casinoRound.findFirst({ where: { id: roundId, userId } });
      if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
      if (round.status !== 'OPEN') {
        throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This hand is already finished.' });
      }

      const publicState = this.parsePublic(round);
      const privateState = this.parsePrivate(round);

      if (action === 'DOUBLE') {
        if (!config.doubleDownEnabled || publicState.playerCards.length !== 2 || publicState.doubled) {
          throw new ConflictException({
            code: 'DOUBLE_NOT_ALLOWED',
            message: 'Double down is only available on your first two cards.',
          });
        }
      }

      await tx.casinoRoundAction.create({
        data: {
          roundId,
          userId,
          action,
          payload: { action },
          idempotencyKey: input.idempotencyKey,
        },
      });

      const baseStake = BigInt(publicState.baseStake);
      let totalStake = round.stake;
      let playerCards = [...publicState.playerCards];
      let cursor = privateState.cursor;
      let doubled = publicState.doubled;

      if (action === 'DOUBLE') {
        await this.rounds.debitAdditionalStake(
          tx,
          userId,
          roundId,
          baseStake,
          `casino:bet:${roundId}:double`,
          'Casino blackjack double down',
        );
        totalStake = round.stake + baseStake;
        doubled = true;
        playerCards.push(privateState.shoe[cursor]);
        cursor += 1;
      } else if (action === 'HIT') {
        playerCards.push(privateState.shoe[cursor]);
        cursor += 1;
      }

      // HIT leaves the hand open unless the player busts. STAND and DOUBLE
      // always finish the hand.
      const playerBusted = isBust(playerCards);
      const finishes = action !== 'HIT' || playerBusted;

      if (!finishes) {
        const updated = await tx.casinoRound.updateMany({
          where: { id: roundId, status: 'OPEN' },
          data: {
            publicState: { ...publicState, playerCards },
            privateState: { ...privateState, cursor },
          },
        });
        if (updated.count !== 1) {
          throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This hand is already finished.' });
        }
        return tx.casinoRound.findFirstOrThrow({ where: { id: roundId, userId } });
      }

      // The dealer only draws when the player has not busted.
      const dealerPlay = playerBusted
        ? { cards: privateState.dealerCards, cursor }
        : playDealer(privateState.shoe, privateState.dealerCards, cursor, config);
      const settlement = settleHand(playerCards, dealerPlay.cards, config);
      const payout = blackjackPayout(
        totalStake,
        settlement.returnNumerator,
        settlement.returnDenominator,
      );
      this.rounds.assertPayoutFits(payout);

      const updated = await tx.casinoRound.updateMany({
        where: { id: roundId, status: 'OPEN' },
        data: {
          status: this.statusFor(settlement.outcome),
          stake: totalStake,
          multiplier: new Prisma.Decimal(settlement.returnNumerator)
            .div(settlement.returnDenominator),
          payout,
          settledAt: new Date(),
          publicState: {
            ...publicState,
            playerCards,
            dealerCards: dealerPlay.cards,
            dealerHoleHidden: false,
            doubled,
            outcome: settlement.outcome,
          },
          privateState: { ...privateState, cursor: dealerPlay.cursor },
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({ code: 'ROUND_NOT_OPEN', message: 'This hand is already finished.' });
      }

      if (payout > 0n) {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
        await this.rounds.creditWin(tx, roundId, userId, wallet.id, payout);
      }

      await tx.auditLog.create({
        data: {
          actorId: userId,
          targetType: 'CASINO_ROUND',
          targetId: roundId,
          action: payout > 0n ? 'CASINO_ROUND_WON' : 'CASINO_ROUND_LOST',
          result: settlement.outcome,
          metadata: {
            gameType: 'BLACKJACK',
            action,
            payout: payout.toString(),
            stake: totalStake.toString(),
          },
        },
      });
      return tx.casinoRound.findFirstOrThrow({ where: { id: roundId, userId } });
    }, { maxWait: 10_000, timeout: 20_000 });

    this.logger.log({ event: 'CASINO_ROUND_SETTLED', gameType: 'BLACKJACK', roundId });
    return this.view(settled);
  }

  hit(userId: string, roundId: string, input: BlackjackActionDto) {
    return this.act(userId, roundId, 'HIT', input);
  }

  stand(userId: string, roundId: string, input: BlackjackActionDto) {
    return this.act(userId, roundId, 'STAND', input);
  }

  double(userId: string, roundId: string, input: BlackjackActionDto) {
    return this.act(userId, roundId, 'DOUBLE', input);
  }
}
