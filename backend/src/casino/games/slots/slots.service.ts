import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { casinoConfig } from '../../casino.config';
import { CasinoRoundService } from '../../casino-round.service';
import { SpinSlotDto } from './slot.dto';
import {
  FOOLS_GOLD_RUSH_PROFILES,
  findSlotDefinition,
  slotDefinitions,
  slotProfile,
  slotVersion,
  validateSlotDefinition,
} from './slot.definitions';
import { CasinoConfigService } from '../../casino-config.service';
import { resolveSpin, slotDomain, slotPayout } from './slot.engine';
import { analyseSlotRtp } from './slot.rtp';
import { SlotGameDefinition } from './slot.types';

/**
 * Server-authoritative slots.
 *
 * The service owns nothing mathematical: it resolves an immutable definition,
 * validates the stake, and hands the committed fairness inputs to the pure
 * engine. Adding a slot means adding a definition, not touching this file.
 */
@Injectable()
export class SlotsService implements OnModuleInit {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    private readonly rounds: CasinoRoundService,
    private readonly configs: CasinoConfigService,
  ) {}

  /**
   * Fail fast on a bad built-in definition. An invalid slot is a maths bug, not
   * a runtime condition, so the application refuses to start rather than
   * serving spins whose declared RTP does not match their own configuration.
   */
  onModuleInit() {
    // Every approved profile, not just the default, must satisfy its own exact
    // RTP claim before the application will serve a single spin.
    for (const definition of Object.values(FOOLS_GOLD_RUSH_PROFILES)) {
      validateSlotDefinition(definition);
    }
    for (const definition of slotDefinitions()) {
      validateSlotDefinition(definition);
      this.logger.log({
        event: 'SLOT_DEFINITION_VALIDATED',
        gameId: definition.gameId,
        version: slotVersion(definition),
        rtpBps: definition.declaredRtpBps,
      });
    }
  }

  private definition(gameId: string): SlotGameDefinition {
    const definition = findSlotDefinition(gameId);
    if (!definition) {
      throw new NotFoundException({
        code: 'SLOT_GAME_NOT_FOUND',
        message: 'That slot game is not available.',
      });
    }
    return definition;
  }

  /**
   * The smallest stake that still gives every payline a whole point of bet.
   * Below it, line returns would floor away and the published paytable would
   * stop describing what a player actually receives.
   */
  private minimumStake(definition: SlotGameDefinition) {
    const configured = casinoConfig().minStake;
    const perLine = BigInt(definition.paylines.length);
    return configured > perLine ? configured : perLine;
  }

  /** Safe public rules for one slot. Contains no seed or unrevealed state. */
  publicGameConfig(definition: SlotGameDefinition) {
    const config = casinoConfig();
    const analysis = analyseSlotRtp(definition);
    return {
      gameId: definition.gameId,
      name: definition.name,
      description: definition.description,
      version: slotVersion(definition),
      mathVersion: definition.mathVersion,
      reels: definition.reels,
      rows: definition.rows,
      paylineCount: definition.paylines.length,
      paylines: definition.paylines,
      symbols: definition.symbols,
      paytable: definition.paytable,
      scatter: definition.scatter,
      volatility: definition.volatility,
      rtpBps: definition.declaredRtpBps,
      rtpPercent: analysis.rtpPercent,
      houseEdgeBps: 10_000 - definition.declaredRtpBps,
      maxWinMultiplier: new Prisma.Decimal(definition.maxWinCenti).div(100).toFixed(2),
      minStake: this.minimumStake(definition).toString(),
      maxStake: config.maxStake.toString(),
      rules: {
        paylineDirection: 'LEFT_TO_RIGHT_FROM_REEL_ONE',
        activePaylines: 'ALL_ALWAYS_ACTIVE',
        wild: 'Wild substitutes for any paying symbol. It never substitutes for Scatter.',
        scatter: definition.scatter
          ? `${definition.scatter.minimumCount}+ scatters anywhere pay on the total stake.`
          : null,
        payoutSemantics:
          'Paytable multipliers are per line bet (stake / paylines); scatter multipliers are on the total stake.',
      },
    };
  }

  /**
   * Public config for the shared endpoint, reflecting the profile an operator
   * has activated rather than the built-in default.
   */
  async publicConfig() {
    const games = [];
    for (const definition of slotDefinitions()) {
      const { definition: active } = await this.activeDefinition(definition.gameId);
      games.push(this.publicGameConfig(active));
    }
    return { gameType: 'SLOTS', games };
  }

  async gameConfig(gameId: string) {
    const { definition } = await this.activeDefinition(gameId);
    return this.publicGameConfig(definition);
  }

  /** The approved profile an operator has activated, plus its stake limits. */
  private async activeDefinition(gameId: string) {
    this.definition(gameId);
    const effective = await this.configs.effective('fools-gold-rush');
    const profile = typeof effective.gameSpecific.profile === 'string'
      ? effective.gameSpecific.profile
      : 'STANDARD';
    return { definition: slotProfile(gameId, profile), effective, profile };
  }

  async spin(userId: string, gameId: string, input: SpinSlotDto) {
    await this.configs.assertPlayable('fools-gold-rush');
    const { definition, effective } = await this.activeDefinition(gameId);
    const version = slotVersion(definition);
    const configuredMinimum = effective.minStake;
    const lineMinimum = BigInt(definition.paylines.length);
    const minStake = configuredMinimum > lineMinimum ? configuredMinimum : lineMinimum;

    if (!Number.isSafeInteger(input.stake) || input.stake <= 0) {
      throw new BadRequestException({ code: 'INVALID_STAKE', message: 'Stake must be a whole number of points.' });
    }
    const stake = BigInt(input.stake);
    if (stake < minStake) {
      throw new BadRequestException({
        code: 'STAKE_BELOW_MINIMUM',
        message: `Minimum stake is ${minStake} points, one per payline.`,
      });
    }
    if (stake > effective.maxStake) {
      throw new BadRequestException({
        code: 'STAKE_ABOVE_MAXIMUM',
        message: `Maximum stake is ${effective.maxStake} points.`,
      });
    }

    const prepared = this.rounds.prepare(input.clientSeed, slotDomain(definition, version));
    const spin = resolveSpin(prepared.fairness, definition);
    const payout = slotPayout(definition, stake, spin.returnNumerator);

    const round = await this.rounds.openRound({
      userId,
      gameId: definition.gameId,
      gameType: 'SLOTS',
      gameVersion: version,
      stake,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: 'Casino slots stake',
      outcome: {
        status: payout > 0n ? 'WON' : 'LOST',
        multiplier: new Prisma.Decimal(spin.returnNumerator)
          .div(definition.paylines.length * 100),
        payout,
        publicState: {
          gameId: definition.gameId,
          stops: spin.stops,
          matrix: spin.matrix,
          lineWins: spin.lineWins,
          scatterWin: spin.scatterWin,
          returnNumerator: spin.returnNumerator,
          totalMultiplier: spin.totalMultiplier,
          capped: spin.capped,
          config: {
            version,
            rtpBps: definition.declaredRtpBps,
            paylineCount: definition.paylines.length,
          },
        },
        // An instant game hides nothing beyond the seed: the stops are already
        // public, and they are what the verifier reproduces.
        privateState: { stops: spin.stops },
      },
    });

    this.logger.log({
      event: payout > 0n ? 'CASINO_ROUND_WON' : 'CASINO_ROUND_LOST',
      gameType: 'SLOTS',
      gameId: definition.gameId,
      gameVersion: version,
      roundId: round.id,
      stake: stake.toString(),
      payout: payout.toString(),
    });
    return this.rounds.publicView(round);
  }
}
