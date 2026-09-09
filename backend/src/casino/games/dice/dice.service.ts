import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DiceConfig, casinoConfig } from '../../casino.config';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoRoundService } from '../../casino-round.service';
import {
  DiceMode,
  diceDomain,
  diceMultiplier,
  diceProbability,
  diceWinCount,
  resolveDice,
} from './dice.engine';
import { PlayDiceDto } from './dice.dto';

/**
 * Server-authoritative Dice.
 *
 * The client chooses only a stake, a direction, and a target. The roll, the
 * win/loss decision, the multiplier, and the payout are all computed here from
 * the committed server seed, inside the same transaction that moves points.
 */
@Injectable()
export class DiceService {
  private readonly logger = new Logger(DiceService.name);

  constructor(
    private readonly rounds: CasinoRoundService,
    private readonly configs: CasinoConfigService,
  ) {}

  /**
   * The mathematics a new round must use: the code baseline overlaid with the
   * operator's currently active version. The version label travels onto the
   * round, so a settled round can always be resolved back to this exact maths.
   */
  private async config(): Promise<DiceConfig> {
    const base = casinoConfig().dice;
    const effective = await this.configs.effective('dice');
    const rtpBps = effective.rtpBps ?? base.rtpBps;
    return {
      ...base,
      minStake: effective.minStake,
      maxStake: effective.maxStake,
      rtpBps,
      houseEdgeBps: 10_000 - rtpBps,
      version: effective.versionLabel,
    };
  }

  /** Public, non-secret configuration used by the UI to show estimates. */
  async publicConfig() {
    const config = await this.config();
    return {
      minTarget: config.minTarget,
      maxTarget: config.maxTarget,
      scale: config.scale,
      modes: ['ROLL_UNDER', 'ROLL_OVER'],
      rtpBps: config.rtpBps,
      houseEdgeBps: config.houseEdgeBps,
      version: config.version,
      minStake: config.minStake.toString(),
      maxStake: config.maxStake.toString(),
    };
  }

  private assertTarget(mode: DiceMode, target: number, config: DiceConfig) {
    if (target < config.minTarget || target > config.maxTarget) {
      throw new BadRequestException({
        code: 'INVALID_TARGET',
        message: `Target must be between ${config.minTarget} and ${config.maxTarget}.`,
      });
    }
    if (diceWinCount(mode, target, config) <= 0) {
      throw new BadRequestException({
        code: 'INVALID_TARGET',
        message: 'Target admits no winning outcomes.',
      });
    }
  }

  /** Informational odds for a prospective bet; the authoritative copy is recomputed at play time. */
  async quote(mode: DiceMode, target: number) {
    const config = await this.config();
    this.assertTarget(mode, target, config);
    return {
      mode,
      target,
      winCount: diceWinCount(mode, target, config),
      winProbability: diceProbability(mode, target, config).toString(),
      multiplier: diceMultiplier(mode, target, config).toString(),
      rtpBps: config.rtpBps,
      houseEdgeBps: config.houseEdgeBps,
      version: config.version,
    };
  }

  async play(userId: string, input: PlayDiceDto) {
    // Availability and mathematics both come from the operator's active
    // configuration, resolved before any point is debited.
    await this.configs.assertPlayable('dice');
    const config = await this.config();
    const stake = this.rounds.assertStake(input.stake, config);
    this.assertTarget(input.mode, input.target, config);

    const prepared = this.rounds.prepare(input.clientSeed, diceDomain(config));
    const resolution = resolveDice(
      prepared.fairness,
      config,
      input.mode,
      input.target,
      stake,
    );

    const round = await this.rounds.openRound({
      userId,
      gameId: 'dice',
      gameType: 'DICE',
      gameVersion: config.version,
      stake,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: 'Casino dice stake',
      outcome: {
        status: resolution.won ? 'WON' : 'LOST',
        multiplier: resolution.won ? resolution.multiplier : new Prisma.Decimal(0),
        payout: resolution.payout,
        publicState: {
          mode: input.mode,
          target: input.target,
          roll: resolution.roll,
          won: resolution.won,
          winCount: resolution.winCount,
          winProbability: resolution.probability.toString(),
          quotedMultiplier: resolution.multiplier.toString(),
          config: {
            version: config.version,
            rtpBps: config.rtpBps,
            houseEdgeBps: config.houseEdgeBps,
            scale: config.scale,
          },
        },
        // Dice hides nothing beyond the seed itself; the roll is already public.
        privateState: { roll: resolution.roll },
      },
    });

    this.logger.log({
      event: resolution.won ? 'CASINO_ROUND_WON' : 'CASINO_ROUND_LOST',
      gameType: 'DICE',
      roundId: round.id,
    });
    return this.rounds.publicView(round);
  }
}
