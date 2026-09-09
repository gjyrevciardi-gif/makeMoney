import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RouletteConfig, casinoConfig } from '../../casino.config';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoRoundService } from '../../casino-round.service';
import { PlayRouletteDto } from './roulette.dto';
import {
  ROULETTE_BET_TYPES,
  RouletteBetInput,
  pocketColour,
  rouletteDomain,
  rouletteMultiplier,
  rouletteWinningPockets,
  resolveRoulette,
} from './roulette.engine';

/**
 * Server-authoritative European roulette.
 *
 * The client submits a set of bets; the winning pocket comes from the
 * committed server seed and every bet is settled against it here. Multiple
 * bets share one spin, the combined stake is debited atomically, and the
 * combined return is credited exactly once.
 */
@Injectable()
export class RouletteService {
  private readonly logger = new Logger(RouletteService.name);

  constructor(
    private readonly rounds: CasinoRoundService,
    private readonly configs: CasinoConfigService,
  ) {}

  /**
   * Stake limits and availability are operator-controlled; the single-zero
   * wheel and its 36/37 return are not, so they always come from the canonical
   * built-in mathematics.
   */
  private async config(): Promise<RouletteConfig> {
    const base = casinoConfig().roulette;
    const effective = await this.configs.effective('roulette');
    return {
      ...base,
      minStake: effective.minStake,
      maxStake: effective.maxStake,
      version: effective.versionLabel,
    };
  }

  async publicConfig() {
    const config = await this.config();
    return {
      pockets: config.pockets,
      maxBetsPerSpin: config.maxBetsPerSpin,
      betTypes: ROULETTE_BET_TYPES.map((type) => ({
        type,
        multiplier: rouletteMultiplier(type),
        winningPockets: type === 'STRAIGHT' ? 1 : rouletteWinningPockets(type),
      })),
      colours: Array.from({ length: config.pockets }, (_, pocket) => ({
        pocket,
        colour: pocketColour(pocket),
      })),
    };
  }

  /**
   * Validates the bet set and returns the total committed stake. Each bet is
   * range-checked individually and the combined stake is checked against the
   * configured limits, so a player cannot bypass the maximum by splitting.
   */
  private validate(input: PlayRouletteDto, config: RouletteConfig): { bets: RouletteBetInput[]; totalStake: bigint } {
    if (input.bets.length > config.maxBetsPerSpin) {
      throw new BadRequestException({
        code: 'TOO_MANY_BETS',
        message: `A spin may carry at most ${config.maxBetsPerSpin} bets.`,
      });
    }

    const seen = new Set<string>();
    const bets = input.bets.map((bet) => {
      if (bet.type === 'STRAIGHT') {
        if (bet.number === undefined) {
          throw new BadRequestException({
            code: 'STRAIGHT_REQUIRES_NUMBER',
            message: 'A straight bet must name a pocket.',
          });
        }
      } else if (bet.number !== undefined) {
        throw new BadRequestException({
          code: 'NUMBER_NOT_ALLOWED',
          message: 'Only a straight bet may name a pocket.',
        });
      }
      const key = `${bet.type}:${bet.number ?? ''}`;
      if (seen.has(key)) {
        throw new BadRequestException({
          code: 'DUPLICATE_BET',
          message: 'Combine repeated bets into a single amount.',
        });
      }
      seen.add(key);
      if (!Number.isSafeInteger(bet.amount) || bet.amount <= 0) {
        throw new BadRequestException({ code: 'INVALID_STAKE', message: 'Each bet must be a whole number of points.' });
      }
      return { type: bet.type, amount: BigInt(bet.amount), number: bet.number };
    });

    const totalStake = bets.reduce((sum, bet) => sum + bet.amount, 0n);
    if (totalStake < config.minStake) {
      throw new BadRequestException({ code: 'STAKE_BELOW_MINIMUM', message: `Minimum total stake is ${config.minStake} points.` });
    }
    if (totalStake > config.maxStake) {
      throw new BadRequestException({ code: 'STAKE_ABOVE_MAXIMUM', message: `Maximum total stake is ${config.maxStake} points.` });
    }
    return { bets, totalStake };
  }

  async play(userId: string, input: PlayRouletteDto) {
    await this.configs.assertPlayable('roulette');
    const config = await this.config();
    const { bets, totalStake } = this.validate(input, config);

    const prepared = this.rounds.prepare(input.clientSeed, rouletteDomain(config));
    const resolution = resolveRoulette(prepared.fairness, config, bets);

    // Total return relative to the whole committed stake, for reporting.
    const multiplier = new Prisma.Decimal(resolution.totalPayout.toString())
      .div(new Prisma.Decimal(resolution.totalStake.toString()))
      .toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN);

    const round = await this.rounds.openRound({
      userId,
      gameId: 'roulette',
      gameType: 'ROULETTE',
      gameVersion: config.version,
      stake: totalStake,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: 'Casino roulette stake',
      outcome: {
        status: resolution.totalPayout > 0n ? 'WON' : 'LOST',
        multiplier,
        payout: resolution.totalPayout,
        publicState: {
          pocket: resolution.pocket,
          colour: resolution.colour,
          bets: resolution.bets,
          totalStake: resolution.totalStake.toString(),
          totalPayout: resolution.totalPayout.toString(),
          config: {
            version: config.version,
            rtpBps: config.rtpBps,
            houseEdgeBps: config.houseEdgeBps,
            pockets: config.pockets,
          },
        },
        // The pocket is already public; nothing else is hidden.
        privateState: { pocket: resolution.pocket },
      },
    });

    this.logger.log({
      event: resolution.totalPayout > 0n ? 'CASINO_ROUND_WON' : 'CASINO_ROUND_LOST',
      gameType: 'ROULETTE',
      roundId: round.id,
    });
    return this.rounds.publicView(round);
  }
}
