import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CasinoGameType,
  CasinoRound,
  CasinoRoundStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { recordWinIfLarge } from '../security/security-events';
import { CasinoGameMath, MAX_SAFE_PAYOUT } from './casino.config';
import { CasinoFairnessService, FairnessInput } from './casino-fairness.service';
import { CasinoGameRegistry } from './casino-game.registry';

export type RoundOutcome = {
  status: CasinoRoundStatus;
  multiplier: Prisma.Decimal | null;
  payout: bigint;
  publicState: Prisma.InputJsonValue;
  privateState: Prisma.InputJsonValue;
};

export type PreparedRound = {
  roundId: string;
  fairness: FairnessInput;
  serverSeedHash: string;
};

const TERMINAL: CasinoRoundStatus[] = ['WON', 'LOST', 'CASHED_OUT', 'CANCELLED'];

export const isTerminal = (status: CasinoRoundStatus) => TERMINAL.includes(status);

/**
 * Shared casino round lifecycle: stake validation, atomic wallet debit,
 * immutable ledger writes, exactly-once payout, and the public projection that
 * decides what a browser is allowed to see.
 *
 * There is no second wallet here. `LedgerEntry` plus `Wallet.balance` remain the
 * only authoritative record of virtual points; `CasinoTransaction` is a
 * game-domain mirror for reporting.
 */
@Injectable()
export class CasinoRoundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fairness: CasinoFairnessService,
    private readonly registry: CasinoGameRegistry = new CasinoGameRegistry(),
  ) {}

  /** Stakes are whole virtual points inside the configured bounds. Never client-trusted. */
  assertStake(stake: number, config: CasinoGameMath): bigint {
    if (!Number.isSafeInteger(stake) || stake <= 0) {
      throw new BadRequestException({ code: 'INVALID_STAKE', message: 'Stake must be a whole number of points.' });
    }
    const value = BigInt(stake);
    if (value < config.minStake) {
      throw new BadRequestException({ code: 'STAKE_BELOW_MINIMUM', message: `Minimum stake is ${config.minStake} points.` });
    }
    if (value > config.maxStake) {
      throw new BadRequestException({ code: 'STAKE_ABOVE_MAXIMUM', message: `Maximum stake is ${config.maxStake} points.` });
    }
    return value;
  }

  assertPayoutFits(payout: bigint) {
    if (payout > MAX_SAFE_PAYOUT) {
      throw new ConflictException({ code: 'PAYOUT_LIMIT_EXCEEDED', message: 'This round exceeds the maximum payout.' });
    }
  }

  /**
   * Creates the fairness commitment for a round before any outcome exists.
   * The raw server seed is stored but never projected while the round is open.
   */
  prepare(clientSeed: string | undefined, domain: string, nonce = 0): PreparedRound & { serverSeed: string } {
    const roundId = randomUUID();
    const { serverSeed, serverSeedHash } = this.fairness.createCommitment();
    return {
      roundId,
      serverSeed,
      serverSeedHash,
      fairness: {
        serverSeed,
        domain,
        clientSeed: this.fairness.normalizeClientSeed(clientSeed, roundId),
        nonce,
      },
    };
  }

  private async existingRound(idempotencyKey: string, userId: string) {
    const prior = await this.prisma.casinoRound.findUnique({ where: { idempotencyKey } });
    if (!prior) return null;
    this.assertIdempotencyOwner(prior, userId);
    return prior;
  }

  private assertIdempotencyOwner(round: Pick<CasinoRound, 'userId'>, userId: string) {
    if (round.userId !== userId) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'This request identifier is already in use.',
      });
    }
  }

  /**
   * Opens a round: atomically debits the stake, writes the immutable
   * `CASINO_BET` ledger entry, and persists the authoritative round. When the
   * game is instant the caller supplies a terminal outcome and the winning
   * credit happens in the same transaction.
   *
   * The debit is a conditional `updateMany` guarded by `balance >= stake`, so
   * two concurrent rounds can never overdraw the wallet; the database
   * additionally refuses any negative balance.
   */
  async openRound(params: {
    userId: string;
    gameId: string;
    gameType: CasinoGameType;
    gameVersion: string;
    stake: bigint;
    idempotencyKey: string;
    prepared: PreparedRound & { serverSeed: string };
    outcome: RoundOutcome;
    reason: string;
  }): Promise<CasinoRound> {
    const prior = await this.existingRound(params.idempotencyKey, params.userId);
    if (prior) return prior;
    this.registry.assertEnabled(params.gameId);
    this.assertPayoutFits(params.outcome.payout);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.casinoRound.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (duplicate) {
          // The pre-transaction lookup can legitimately race another request.
          // Re-check ownership on this authoritative read before replaying a
          // globally unique idempotency key, otherwise another user's round
          // (including its hidden state and seed) could be returned.
          this.assertIdempotencyOwner(duplicate, params.userId);
          return duplicate;
        }

        const wallet = await tx.wallet.findUnique({ where: { userId: params.userId } });
        if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');

        const debited = await tx.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: params.stake } },
          data: { balance: { decrement: params.stake } },
        });
        if (debited.count !== 1) {
          throw new ConflictException({
            code: 'INSUFFICIENT_VIRTUAL_BALANCE',
            message: 'Insufficient virtual points.',
          });
        }

        const terminal = isTerminal(params.outcome.status);
        const round = await tx.casinoRound.create({
          data: {
            id: params.prepared.roundId,
            userId: params.userId,
            gameType: params.gameType,
            gameVersion: params.gameVersion,
            status: params.outcome.status,
            stake: params.stake,
            multiplier: params.outcome.multiplier,
            payout: params.outcome.payout,
            serverSeed: params.prepared.serverSeed,
            serverSeedHash: params.prepared.serverSeedHash,
            clientSeed: params.prepared.fairness.clientSeed,
            nonce: params.prepared.fairness.nonce,
            publicState: params.outcome.publicState,
            privateState: params.outcome.privateState,
            idempotencyKey: params.idempotencyKey,
            settledAt: terminal ? new Date() : null,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            type: 'CASINO_BET',
            amount: -params.stake,
            reason: params.reason,
            actorId: params.userId,
            relatedCasinoRoundId: round.id,
            idempotencyKey: `casino:bet:${round.id}`,
          },
        });
        await tx.casinoTransaction.create({
          data: {
            roundId: round.id,
            userId: params.userId,
            type: 'BET',
            amount: -params.stake,
            idempotencyKey: `casino:bet:${round.id}`,
          },
        });

        if (params.outcome.payout > 0n) {
          await this.creditWin(tx, round.id, params.userId, wallet.id, params.outcome.payout);
        }

        await tx.auditLog.create({
          data: {
            actorId: params.userId,
            targetType: 'CASINO_ROUND',
            targetId: round.id,
            action: 'CASINO_ROUND_STARTED',
            result: params.outcome.status,
            metadata: {
              gameType: params.gameType,
              gameVersion: params.gameVersion,
              stake: params.stake.toString(),
              payout: params.outcome.payout.toString(),
            },
          },
        });
        return round;
      }, { maxWait: 10_000, timeout: 20_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.existingRound(params.idempotencyKey, params.userId);
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  /**
   * Credits a winning payout exactly once. The deterministic ledger key is
   * unique, so a retry, a concurrent cashout, and a replayed request all
   * converge on a single credit.
   */
  async creditWin(
    tx: Prisma.TransactionClient,
    roundId: string,
    userId: string,
    walletId: string,
    payout: bigint,
  ) {
    if (payout <= 0n) return;
    const key = `casino:win:${roundId}`;
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (existing) return;
    await tx.ledgerEntry.create({
      data: {
        walletId,
        type: 'CASINO_WIN',
        amount: payout,
        reason: 'Casino winning payout',
        relatedCasinoRoundId: roundId,
        idempotencyKey: key,
      },
    });
    await tx.casinoTransaction.create({
      data: { roundId, userId, type: 'WIN', amount: payout, idempotencyKey: key },
    });
    const credited = await tx.wallet.update({
      where: { id: walletId },
      data: { balance: { increment: payout } },
    });
    await recordWinIfLarge(tx, { userId, amount: payout, balanceAfter: credited.balance, refType: 'CASINO_ROUND', refId: roundId });
  }

  /**
   * Commits further stake to an already-open round, as a double down does.
   *
   * The debit is conditional on the wallet still covering it, and the ledger
   * key is derived from the round and the reason, so a retry of the same
   * action can never charge twice.
   */
  async debitAdditionalStake(
    tx: Prisma.TransactionClient,
    userId: string,
    roundId: string,
    amount: bigint,
    key: string,
    reason: string,
  ) {
    if (amount <= 0n) throw new BadRequestException({ code: 'INVALID_STAKE', message: 'Invalid additional stake.' });
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (existing) return;
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
    const debited = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (debited.count !== 1) {
      throw new ConflictException({
        code: 'INSUFFICIENT_VIRTUAL_BALANCE',
        message: 'Insufficient virtual points.',
      });
    }
    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: 'CASINO_BET',
        amount: -amount,
        reason,
        actorId: userId,
        relatedCasinoRoundId: roundId,
        idempotencyKey: key,
      },
    });
    await tx.casinoTransaction.create({
      data: { roundId, userId, type: 'BET', amount: -amount, idempotencyKey: key },
    });
  }

  /** Ownership-scoped lookup. A round belonging to another user is simply not found. */
  async ownedRound(userId: string, roundId: string) {
    const round = await this.prisma.casinoRound.findFirst({ where: { id: roundId, userId } });
    if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    return round;
  }

  /**
   * The only projection a browser ever receives.
   *
   * While a round is OPEN the hidden state and the raw server seed are omitted
   * entirely — not blanked out downstream — so a future field added to
   * `privateState` cannot leak by accident. Both are revealed once the round is
   * terminal, which is what makes the result verifiable.
   */
  publicView(round: CasinoRound) {
    const terminal = isTerminal(round.status);
    return {
      roundId: round.id,
      gameType: round.gameType,
      gameVersion: round.gameVersion,
      status: round.status,
      stake: round.stake.toString(),
      multiplier: round.multiplier ? round.multiplier.toString() : null,
      payout: round.payout.toString(),
      createdAt: round.createdAt,
      settledAt: round.settledAt,
      state: round.publicState,
      fairness: {
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        ...(terminal
          ? { serverSeed: round.serverSeed, revealedState: round.privateState }
          : {}),
      },
    };
  }
}
