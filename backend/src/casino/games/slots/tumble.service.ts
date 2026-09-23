import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoGameId } from '../../casino-game.registry';
import { CasinoRoundService } from '../../casino-round.service';
import {
  findTumbleDefinition,
  tumbleDefinitions,
  tumbleVersion,
  validateTumbleDefinition,
} from './tumble.definition';
import {
  resolveTumbleRound,
  tumbleCharge,
  tumbleDomain,
  tumblePayout,
} from './tumble.engine';
import { SpinTumbleDto } from './tumble.dto';
import { TumbleGameDefinition, TumbleMode } from './tumble.types';

/**
 * Server-authoritative tumbling slots.
 *
 * The service owns nothing mathematical: it resolves an immutable definition,
 * validates the bet, and hands the committed fairness inputs to the pure
 * engine. A whole free-spin session - including retriggers - is resolved here,
 * in one call, and the browser only ever replays it. That is deliberate: it
 * keeps the wallet, the ledger and the idempotency key exactly as they are for
 * any other instant game, one stake and one payout per round, with no
 * half-finished session that an operator or a crash could strand.
 */
@Injectable()
export class TumbleSlotsService implements OnModuleInit {
  private readonly logger = new Logger(TumbleSlotsService.name);

  constructor(
    private readonly rounds: CasinoRoundService,
    private readonly configs: CasinoConfigService,
  ) {}

  /**
   * Fail fast on a bad built-in definition. An invalid game is a maths bug, not
   * a runtime condition, so the application refuses to start rather than
   * serving spins whose structure does not match what it publishes.
   */
  onModuleInit() {
    for (const definition of tumbleDefinitions()) {
      validateTumbleDefinition(definition);
      this.logger.log({
        event: 'TUMBLE_DEFINITION_VALIDATED',
        gameId: definition.gameId,
        version: tumbleVersion(definition),
        rtpBps: definition.declaredRtpBps,
      });
    }
  }

  private definition(gameId: string): TumbleGameDefinition {
    const definition = findTumbleDefinition(gameId);
    if (!definition) {
      throw new NotFoundException({
        code: 'SLOT_GAME_NOT_FOUND',
        message: 'That slot game is not available.',
      });
    }
    return definition;
  }

  /** Safe public rules for one game. Contains no seed or unrevealed state. */
  publicGameConfig(definition: TumbleGameDefinition, limits: { minStake: bigint; maxStake: bigint }) {
    // Buying the feature debits the published price, so the largest bet that
    // can be bought is the one whose price still fits inside the stake ceiling.
    const maxBuyBet = (limits.maxStake * 100n) / BigInt(definition.buyFeatureCenti);
    return {
      gameId: definition.gameId,
      name: definition.name,
      description: definition.description,
      version: tumbleVersion(definition),
      mathVersion: definition.mathVersion,
      reels: definition.reels,
      rows: definition.rows,
      symbols: definition.symbols,
      paytable: definition.paytable,
      minCluster: definition.minCluster,
      scatterPay: definition.scatterPay,
      orbFaces: definition.orbFaces.map((face) => face.value),
      freeSpins: definition.freeSpins,
      buyFeatureCenti: definition.buyFeatureCenti,
      buyFeatureMultiplier: (definition.buyFeatureCenti / 100).toFixed(2),
      volatility: definition.volatility,
      rtpBps: definition.declaredRtpBps,
      rtpPercent: (definition.declaredRtpBps / 100).toFixed(2),
      houseEdgeBps: 10_000 - definition.declaredRtpBps,
      maxWinMultiplier: (definition.maxWinCenti / 100).toFixed(0),
      minStake: limits.minStake.toString(),
      maxStake: limits.maxStake.toString(),
      maxBuyBet: (maxBuyBet > limits.minStake ? maxBuyBet : limits.minStake).toString(),
      rules: {
        pays: `Any ${definition.minCluster} or more matching symbols anywhere on the board pay on the total bet.`,
        tumble:
          'Winning symbols are removed, the symbols above them fall, and new symbols drop in. '
          + 'The chain continues until a drop pays nothing.',
        orbs:
          'Storm orbs never pay on their own. They stay on the board for the whole chain, and '
          + 'their values are added together and applied to that spin’s symbol wins.',
        freeSpins:
          `${definition.freeSpins.trigger} scatters award ${definition.freeSpins.award} free spins. `
          + `During them the orb total carries over from spin to spin and never resets. `
          + `${definition.freeSpins.retrigger} scatters add ${definition.freeSpins.retriggerAward} more.`,
        buyFeature:
          `Buying the feature costs ${(definition.buyFeatureCenti / 100).toFixed(0)}x the bet and `
          + 'starts the free spins immediately.',
        payoutSemantics:
          'Every multiplier is on one bet. Scatter pays are never multiplied by the orb total.',
        returnBasis:
          'The published return is a simulated figure for this configuration, not an exact '
          + 'enumeration: a tumble chain has no closed form.',
      },
    };
  }

  /** Public config for every tumbling slot, under the operator's limits. */
  async publicConfig() {
    const games = [];
    for (const definition of tumbleDefinitions()) {
      games.push(await this.gameConfig(definition.gameId));
    }
    return { gameType: 'SLOTS', family: 'TUMBLE', games };
  }

  async gameConfig(gameId: string) {
    const definition = this.definition(gameId);
    const effective = await this.configs.effective(definition.gameId as CasinoGameId);
    return this.publicGameConfig(definition, {
      minStake: effective.minStake,
      maxStake: effective.maxStake,
    });
  }

  async spin(userId: string, gameId: string, input: SpinTumbleDto) {
    const definition = this.definition(gameId);
    await this.configs.assertPlayable(definition.gameId as CasinoGameId);
    const effective = await this.configs.effective(definition.gameId as CasinoGameId);
    const version = tumbleVersion(definition);
    const mode: TumbleMode = input.mode === 'BUY_FEATURE' ? 'BUY_FEATURE' : 'BASE';

    if (!Number.isSafeInteger(input.stake) || input.stake <= 0) {
      throw new BadRequestException({
        code: 'INVALID_STAKE',
        message: 'Bet must be a whole number of points.',
      });
    }
    const bet = BigInt(input.stake);
    if (bet < effective.minStake) {
      throw new BadRequestException({
        code: 'STAKE_BELOW_MINIMUM',
        message: `Minimum bet is ${effective.minStake} points.`,
      });
    }
    const charge = tumbleCharge(definition, bet, mode);
    // The stake ceiling bounds what the wallet is actually debited, not the
    // nominal bet, so buying the feature can never charge past the limit an
    // operator set.
    if (charge > effective.maxStake) {
      throw new BadRequestException({
        code: 'STAKE_ABOVE_MAXIMUM',
        message: mode === 'BUY_FEATURE'
          ? `Buying the feature at this bet would cost ${charge} points, above the ${effective.maxStake} point maximum.`
          : `Maximum bet is ${effective.maxStake} points.`,
      });
    }

    const prepared = this.rounds.prepare(input.clientSeed, tumbleDomain(definition, version));
    const result = resolveTumbleRound(prepared.fairness, definition, mode);
    const payout = tumblePayout(bet, result.totalCenti);

    const round = await this.rounds.openRound({
      userId,
      gameId: definition.gameId,
      gameType: 'SLOTS',
      gameVersion: version,
      stake: charge,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: mode === 'BUY_FEATURE' ? 'Casino slots feature purchase' : 'Casino slots stake',
      outcome: {
        status: payout > 0n ? 'WON' : 'LOST',
        // Relative to what was charged, so a bought feature is not reported as
        // a hundred times better than it was.
        multiplier: new Prisma.Decimal(payout.toString()).div(charge.toString()),
        payout,
        publicState: {
          gameId: definition.gameId,
          family: 'TUMBLE',
          mode: result.mode,
          bet: bet.toString(),
          charge: charge.toString(),
          base: result.base,
          feature: result.feature,
          totalCenti: result.totalCenti,
          totalMultiplier: result.totalMultiplier,
          capped: result.capped,
          config: {
            version,
            rtpBps: definition.declaredRtpBps,
            reels: definition.reels,
            rows: definition.rows,
          },
        },
        // An instant game hides nothing beyond the seed: the whole round is
        // already public, and the seed is what the verifier replays it from.
        privateState: { mode: result.mode, totalCenti: result.totalCenti },
      },
    });

    this.logger.log({
      event: payout > 0n ? 'CASINO_ROUND_WON' : 'CASINO_ROUND_LOST',
      gameType: 'SLOTS',
      gameId: definition.gameId,
      gameVersion: version,
      roundId: round.id,
      mode: result.mode,
      stake: charge.toString(),
      payout: payout.toString(),
    });
    return this.rounds.publicView(round);
  }
}
