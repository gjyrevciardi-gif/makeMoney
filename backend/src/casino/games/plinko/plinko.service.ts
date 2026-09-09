import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { casinoConfig } from '../../casino.config';
import { CasinoConfigService } from '../../casino-config.service';
import { CasinoRoundService } from '../../casino-round.service';
import { PlayPlinkoDto } from './plinko.dto';
import {
  PLINKO_RISKS,
  PLINKO_ROWS,
  PlinkoRisk,
  isSupportedRisk,
  isSupportedRows,
  plinkoBucketProbability,
  plinkoDomain,
  plinkoPaytable,
  plinkoTheoreticalRtp,
  plinkoTheoreticalRtpBps,
  plinkoVersion,
  resolvePlinko,
} from './plinko.engine';

/**
 * Server-authoritative Plinko.
 *
 * An instant game on the existing single-transaction round path: the stake is
 * debited, the path is derived from the committed seed, the bucket and payout
 * follow from the frozen paytable, and the win is credited, all inside one
 * transaction. The client receives the finished result and animates the exact
 * path the server produced.
 */
@Injectable()
export class PlinkoService {
  private readonly logger = new Logger(PlinkoService.name);

  constructor(
    private readonly rounds: CasinoRoundService,
    private readonly configs: CasinoConfigService,
  ) {}

  /** Operator-controlled stake limits; the paytables stay frozen constants. */
  private async limits() {
    const effective = await this.configs.effective('plinko');
    return { minStake: effective.minStake, maxStake: effective.maxStake };
  }

  private config() {
    return casinoConfig().plinko;
  }

  /** Public, non-secret configuration: the authoritative paytables themselves. */
  publicConfig() {
    const config = this.config();
    const boards = [];
    for (const rows of PLINKO_ROWS) {
      for (const risk of PLINKO_RISKS) {
        boards.push({
          rows,
          risk,
          version: plinkoVersion(config, rows, risk),
          buckets: rows + 1,
          paytable: plinkoPaytable(rows, risk),
          rtpBps: plinkoTheoreticalRtpBps(rows, risk),
          rtpPercent: plinkoTheoreticalRtp(rows, risk).mul(100).toFixed(4),
          bucketProbabilities: Array.from({ length: rows + 1 }, (_, bucket) =>
            plinkoBucketProbability(rows, bucket).toFixed(8)),
        });
      }
    }
    return {
      gameType: config.gameType,
      gameId: config.gameId,
      mathVersion: config.mathVersion,
      minStake: config.minStake.toString(),
      maxStake: config.maxStake.toString(),
      supportedRows: [...PLINKO_ROWS],
      riskLevels: [...PLINKO_RISKS],
      targetRtpBps: config.targetRtpBps,
      rtpToleranceBps: config.rtpToleranceBps,
      boards,
      note: 'Paytables are frozen version 1 constants; each board reports the exact RTP computed from its own table.',
    };
  }

  private assertBoard(rows: number, risk: string): asserts risk is PlinkoRisk {
    if (!isSupportedRows(rows)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_ROWS',
        message: `Rows must be one of ${PLINKO_ROWS.join(', ')}.`,
      });
    }
    if (!isSupportedRisk(risk)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_RISK',
        message: `Risk must be one of ${PLINKO_RISKS.join(', ')}.`,
      });
    }
  }

  async play(userId: string, input: PlayPlinkoDto) {
    await this.configs.assertPlayable('plinko');
    const config = this.config();
    this.assertBoard(input.rows, input.risk);
    const stake = this.rounds.assertStake(
      input.stake,
      { ...config, ...(await this.limits()) } as never,
    );

    // The board's own version is the round's version, so a settled round always
    // points at the exact table that priced it.
    const version = plinkoVersion(config, input.rows, input.risk);
    const prepared = this.rounds.prepare(input.clientSeed, plinkoDomain(version));
    const resolution = resolvePlinko(prepared.fairness, input.rows, input.risk, stake);

    const round = await this.rounds.openRound({
      userId,
      gameId: 'plinko',
      gameType: 'PLINKO',
      gameVersion: version,
      stake,
      idempotencyKey: input.idempotencyKey,
      prepared,
      reason: 'Casino plinko stake',
      outcome: {
        status: resolution.payout > 0n ? 'WON' : 'LOST',
        multiplier: new Prisma.Decimal(resolution.multiplierCenti).div(100),
        payout: resolution.payout,
        publicState: {
          rows: input.rows,
          risk: input.risk,
          path: resolution.path,
          bucketIndex: resolution.bucketIndex,
          multiplier: resolution.multiplier,
          // The table is stored with the round so history stays self-contained
          // even if a future version changes the frozen constants.
          paytable: resolution.paytable,
          config: {
            version,
            rtpBps: plinkoTheoreticalRtpBps(input.rows, input.risk),
          },
        },
        // Nothing is hidden: an instant game reveals its path with the result.
        privateState: { path: resolution.path, bucketIndex: resolution.bucketIndex },
      },
    });

    this.logger.log({
      event: resolution.payout > 0n ? 'CASINO_ROUND_WON' : 'CASINO_ROUND_LOST',
      gameType: 'PLINKO',
      roundId: round.id,
    });
    return this.rounds.publicView(round);
  }
}
