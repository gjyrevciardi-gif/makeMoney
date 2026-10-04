import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CasinoTransactionType, LedgerType, Prisma } from '@prisma/client';
import { TransactionClient, WalletMovement } from './game-adapter.types';

/**
 * The single money path for every integrated game.
 *
 * A movement is one immutable `LedgerEntry` plus one game-domain
 * `CasinoTransaction` under the same idempotency key, committed inside the
 * caller's transaction so a game can settle a round and move money atomically.
 * The wallet row is locked for the duration of that transaction, so the exact
 * before/after recorded on the ledger entry stays true even when another game
 * spends the same wallet concurrently.
 *
 * There is deliberately no way to assign a balance: every point a wallet holds
 * stays explained by the append-only ledger, and a debit that cannot be covered
 * simply fails. Accounting never decides whether a game result is allowed.
 */
@Injectable()
export class GameWalletService {
  async balance(tx: Pick<TransactionClient, 'wallet'>, userId: string): Promise<bigint> {
    const wallet = await tx.wallet.findUnique({ where: { userId }, select: { balance: true } });
    return wallet?.balance ?? 0n;
  }

  async balancePoints(tx: Pick<TransactionClient, 'wallet'>, userId: string): Promise<number> {
    return toSafePoints(await this.balance(tx, userId), 'wallet balance');
  }

  /** A wager: the round loses the stake before its outcome is presented. */
  debit(tx: TransactionClient, params: WalletMovement) {
    return this.move(tx, params, 'CASINO_BET', 'BET');
  }

  /** A payout: credited exactly once per ledger key. */
  credit(tx: TransactionClient, params: WalletMovement) {
    return this.move(tx, params, 'CASINO_WIN', 'WIN');
  }

  /**
   * A compensating movement for a stake that was taken but never became a
   * round. Exactly-once by ledger key, like every other movement.
   */
  refund(tx: TransactionClient, params: WalletMovement) {
    return this.move(tx, params, 'CASINO_ROLLBACK_REFUND', 'REFUND');
  }

  private async move(
    tx: TransactionClient,
    params: WalletMovement,
    ledgerType: LedgerType,
    transactionType: CasinoTransactionType,
  ) {
    const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: params.key } });
    if (existing) return;
    if (params.amount <= 0n) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Invalid amount.' });
    }

    const debit = ledgerType === 'CASINO_BET';
    const locked = await tx.$queryRaw<Array<{ balance: bigint }>>(
      Prisma.sql`SELECT "balance" FROM "Wallet" WHERE "id" = ${params.walletId}::uuid FOR UPDATE`,
    );
    if (locked.length !== 1) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: 'Wallet not found.' });
    }
    const before = locked[0].balance;
    const after = debit ? before - params.amount : before + params.amount;
    if (after < 0n) {
      throw new ConflictException({ code: 'INSUFFICIENT_VIRTUAL_BALANCE', message: 'Insufficient virtual points.' });
    }
    await tx.wallet.update({ where: { id: params.walletId }, data: { balance: after } });

    await tx.ledgerEntry.create({
      data: {
        walletId: params.walletId,
        type: ledgerType,
        amount: debit ? -params.amount : params.amount,
        reason: params.reason,
        actorId: params.userId,
        relatedCasinoRoundId: params.roundId,
        idempotencyKey: params.key,
        gameSessionId: params.sessionId ?? null,
        actionId: params.actionId ?? null,
        balanceBefore: before,
        balanceAfter: after,
      },
    });
    await tx.casinoTransaction.create({
      data: {
        roundId: params.roundId,
        userId: params.userId,
        type: transactionType,
        amount: debit ? -params.amount : params.amount,
        idempotencyKey: params.key,
      },
    });
  }
}

/**
 * Exact BigInt -> native number conversion at a protocol boundary.
 *
 * Games speak JSON numbers to their own clients; a value the platform cannot
 * represent exactly is refused rather than silently rounded.
 */
export function toSafePoints(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
    throw new ConflictException({
      code: 'BALANCE_OUT_OF_RANGE',
      message: `The ${label} cannot be represented exactly.`,
    });
  }
  return Number(value);
}
