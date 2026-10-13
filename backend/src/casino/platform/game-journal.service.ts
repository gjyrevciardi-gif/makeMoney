import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  GAME_ACTION_GUARD,
  GameActionGuardPort,
  GameReceipt,
  NewPreparedOutcome,
  PreparedOutcome,
  PreparedOutcomeSummary,
  ReadClient,
  SessionTrust,
  TransactionClient,
} from './game-adapter.types';

const LOCK_NAMESPACE_PREFIX = 'casino:';

/**
 * Durable action journal shared by every integrated game.
 *
 * Three responsibilities, all game-agnostic:
 *
 *  - **Idempotency.** One row per (player, request identity) holds the canonical
 *    semantics and the exact response document. The same identity with the same
 *    semantics replays the stored response; the same identity with different
 *    semantics is a conflict.
 *  - **Presentation receipts.** `deliveredAt` records a transmission attempt and
 *    `ackedAt` the client's confirmed rendering of that exact action. The latest
 *    action is resolved by a database-generated monotonic sequence.
 *  - **Prepared outcomes.** An authoritative result is committed here *before*
 *    any money moves, together with the session, action and the exact round
 *    state it was drawn against, so a crash, a lost response or a reconnect can
 *    never cause a reroll, a second debit or a lost round.
 *
 * Every mutation of one player's game is additionally serialized by a
 * transaction-scoped advisory lock, keyed by game and player, and guarded by
 * the authoritative in-transaction session check before any money can move.
 */
@Injectable()
export class GameJournalService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(GAME_ACTION_GUARD) private readonly guard: GameActionGuardPort,
  ) {}

  requestKey(userId: string, requestId: string) {
    return `${userId}:${requestId}`;
  }

  unscopedRequestId(userId: string, requestKey: string) {
    const prefix = `${userId}:`;
    return requestKey.startsWith(prefix) ? requestKey.slice(prefix.length) : requestKey;
  }

  conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  conflictSemantics(): never {
    throw this.conflict('IDEMPOTENCY_KEY_CONFLICT', 'This request identifier was already used for a different action.');
  }

  /** Receipt view for the action currently being delivered in this response. */
  deliveringView(requestId: string, event: string): GameReceipt {
    return { actionId: requestId, event, delivered: false, acked: false };
  }

  private async lock(tx: TransactionClient, gameId: string, userId: string) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${LOCK_NAMESPACE_PREFIX}${gameId}`}), hashtext(${userId}))`,
    );
  }

  /**
   * One transaction-scoped advisory lock serializes a player's whole game, then
   * the authoritative guard authorizes the session inside the same transaction
   * that will move the money. There is no unguarded variant: a gameplay action
   * cannot reach a wallet movement without a bound, version-current session.
   */
  async serialized<T>(
    gameId: string,
    userId: string,
    trust: SessionTrust,
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, gameId, userId);
        await this.guard.assertActionAllowed(tx, { gameId, userId, trust });
        return work(tx);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  async findReplay(gameId: string, userId: string, requestId: string, canonical: string) {
    return this.findReplayIn(this.prisma as unknown as ReadClient, gameId, userId, requestId, canonical);
  }

  /**
   * The single authoritative replay read for every action path.
   *
   * A committed action returns its stored response, so replay stays exactly as
   * it was. An identity whose prepared outcome was terminally cancelled is
   * refused here instead - before any draw, wallet movement, round or action
   * row - and with the same canonical-consistency rule as a committed action,
   * so a cancelled key can never be reused as a new action on the paid-round,
   * gamble, free-spin or collect path.
   */
  async findReplayIn(
    db: ReadClient,
    gameId: string,
    userId: string,
    requestId: string,
    canonical: string,
  ): Promise<Record<string, unknown> | null> {
    const key = this.requestKey(userId, requestId);
    const row = await db.casinoRoundAction.findUnique({ where: { idempotencyKey: key } });
    if (row) {
      if (row.gameId !== gameId) return null;
      if (row.canonical !== canonical) this.conflictSemantics();
      return row.payload as unknown as Record<string, unknown>;
    }
    // No committed action: a terminal cancellation is the only other durable
    // state this identity can have, and it is scoped to its own owner and game.
    const cancelled = await db.gamePreparedOutcome.findUnique({
      where: { requestKey: key },
      select: { userId: true, gameId: true, canonical: true, cancelledAt: true },
    });
    if (!cancelled || cancelled.userId !== userId || cancelled.gameId !== gameId || !cancelled.cancelledAt) {
      return null;
    }
    if (cancelled.canonical !== canonical) this.conflictSemantics();
    throw this.conflict(
      'OUTCOME_CANCELLED',
      'This action was cancelled when the session that started it ended; start a new round.',
    );
  }

  /**
   * Writes the durable response and returns the stored document.
   *
   * Returning the database's own JSON, rather than the object this process just
   * built, is what makes a replay byte-stable: the first delivery and every
   * later replay serialize the same stored value.
   */
  async bookAction(
    tx: TransactionClient,
    params: {
      gameId: string;
      userId: string;
      roundId: string;
      event: string;
      requestId: string;
      canonical: string;
      response: Record<string, unknown>;
    },
  ): Promise<Record<string, unknown>> {
    const key = this.requestKey(params.userId, params.requestId);
    await tx.casinoRoundAction.create({
      data: {
        roundId: params.roundId,
        userId: params.userId,
        action: params.event,
        payload: params.response as unknown as Prisma.InputJsonValue,
        idempotencyKey: key,
        gameId: params.gameId,
        canonical: params.canonical,
        // The delivery marker records the attempt made by this response; the
        // receipt gate only ever trusts `ackedAt`.
        deliveredAt: new Date(),
      },
    });
    const stored = await tx.casinoRoundAction.findUniqueOrThrow({
      where: { idempotencyKey: key },
      select: { payload: true },
    });
    return stored.payload as unknown as Record<string, unknown>;
  }

  private async latestActionIn(tx: ReadClient, gameId: string, userId: string) {
    // `seq` is a database-generated monotonic sequence, so the "latest
    // authoritative action" can never be decided by a random UUID tie-break.
    return tx.casinoRoundAction.findFirst({
      where: { userId, gameId },
      orderBy: [{ seq: 'desc' }],
    });
  }

  /** Receipt state of the latest authoritative action for this player and game. */
  async receipt(db: ReadClient, gameId: string, userId: string): Promise<GameReceipt> {
    const latest = await this.latestActionIn(db, gameId, userId);
    if (!latest) return { actionId: null, event: null, delivered: false, acked: true };
    return {
      actionId: this.unscopedRequestId(userId, latest.idempotencyKey),
      event: latest.action,
      delivered: latest.deliveredAt !== null,
      acked: latest.ackedAt !== null,
    };
  }

  /**
   * Presentation gate. Financial settlement may already be durable, but no
   * further gameplay action may execute until the client confirmed it rendered
   * the previous authoritative result.
   */
  async assertReceiptIn(tx: TransactionClient, gameId: string, userId: string) {
    const latest = await this.latestActionIn(tx, gameId, userId);
    if (latest && !latest.ackedAt) {
      throw this.conflict('ACK_REQUIRED', 'The previous result has not been acknowledged.');
    }
  }

  /**
   * Records the client's confirmed rendering of one exact authoritative action.
   *
   * A receipt settles nothing, moves no money and advances no feature: it only
   * releases the presentation gate. An unknown id is refused, and a stale id
   * can never release a newer pending result.
   */
  async acknowledge(gameId: string, userId: string, actionId: string, trust: SessionTrust) {
    return this.serialized(gameId, userId, trust, async (tx) => {
      const key = this.requestKey(userId, actionId);
      const row = await tx.casinoRoundAction.findUnique({ where: { idempotencyKey: key } });
      if (!row || row.gameId !== gameId) {
        return { actionId, accepted: false, reason: 'unknown action' };
      }
      const latest = await this.latestActionIn(tx, gameId, userId);
      if (!latest || latest.idempotencyKey !== row.idempotencyKey) {
        return { actionId, accepted: false, reason: 'stale action; a newer result is pending' };
      }
      if (!row.ackedAt) {
        await tx.casinoRoundAction.update({ where: { id: row.id }, data: { ackedAt: new Date() } });
      }
      return { actionId, accepted: true };
    });
  }

  async prepareOutcome(tx: TransactionClient, outcome: NewPreparedOutcome) {
    await tx.gamePreparedOutcome.create({
      data: {
        gameId: outcome.gameId,
        userId: outcome.userId,
        requestKey: outcome.requestKey,
        kind: outcome.kind,
        canonical: outcome.canonical,
        sessionId: outcome.sessionId,
        actionId: outcome.actionId,
        body: outcome.body as Prisma.InputJsonValue,
        payload: outcome.payload as Prisma.InputJsonValue,
        roundId: outcome.roundId ?? null,
        originRoundId: outcome.originRoundId,
        originVersion: outcome.originVersion,
        originPhase: outcome.originPhase,
      },
    });
  }

  async findPrepared(userId: string, requestKey: string): Promise<PreparedOutcome | null> {
    return this.findPreparedIn(this.prisma as unknown as TransactionClient, requestKey, userId);
  }

  async findPreparedIn(
    tx: TransactionClient,
    requestKey: string,
    userId?: string,
  ): Promise<PreparedOutcome | null> {
    const row = await tx.gamePreparedOutcome.findUnique({ where: { requestKey } });
    if (!row) return null;
    if (userId !== undefined && row.userId !== userId) return null;
    return {
      requestKey: row.requestKey,
      kind: row.kind,
      canonical: row.canonical,
      sessionId: row.sessionId,
      actionId: row.actionId,
      originRoundId: row.originRoundId,
      originVersion: row.originVersion,
      originPhase: row.originPhase,
      payload: row.payload,
      cancelledAt: row.cancelledAt,
      cancelledReason: row.cancelledReason,
    };
  }

  /**
   * A prepared outcome blocks any other mutation until its own request settles
   * it, which is what keeps two different actions from interleaving. A
   * terminally cancelled outcome is excluded: it can never settle, so it must
   * not block unrelated actions for the rest of the account's life.
   */
  async assertNoForeignPrepared(tx: TransactionClient, gameId: string, userId: string, requestKey: string) {
    const row = await tx.gamePreparedOutcome.findFirst({
      where: { userId, gameId, cancelledAt: null },
      select: { requestKey: true },
    });
    if (row && row.requestKey !== requestKey) {
      throw this.conflict('SETTLEMENT_PENDING', 'A prepared settlement is pending for another request.');
    }
  }

  /**
   * Pending outcomes for reconciliation: terminally cancelled rows are excluded,
   * so a retired credential is never retried forever and never blocks a later,
   * independent action.
   */
  async listPrepared(userId: string, gameId: string): Promise<PreparedOutcomeSummary[]> {
    return this.prisma.gamePreparedOutcome.findMany({
      where: { userId, gameId, cancelledAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { requestKey: true, kind: true, sessionId: true },
    });
  }

  async deletePrepared(tx: TransactionClient, requestKey: string) {
    await tx.gamePreparedOutcome.deleteMany({ where: { requestKey } });
  }

  /**
   * Removes a *superseded* prepared outcome in its own transaction: the failed
   * settlement transaction rolled back, so the delete has to commit separately.
   * Supersession is the existing accepted semantic - a newer round state makes
   * the stored outcome unusable and the identity free again.
   *
   * This is not how a revocation is handled. A outcome retired by a logout,
   * password change or disable is terminally cancelled instead (see
   * `cancelPrepared`), never deleted, so its key can never be redrawn.
   *
   * This mutation carries no authorization decision: the row it deletes never
   * settled, so there is no round, no ledger entry and no money behind it.
   */
  async discardPrepared(gameId: string, userId: string, requestKey: string) {
    await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, gameId, userId);
        await this.deletePrepared(tx, requestKey);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  /**
   * Marks a pending outcome terminally cancelled, in its own transaction.
   *
   * The row is never deleted: its request identity, canonical semantics and the
   * outcome that was already drawn stay durable, so the key can never be
   * prepared (and therefore never redrawn) again, while unrelated actions are
   * free to proceed.
   *
   * The mark is only written when the stored origin is genuinely unusable, and
   * that verdict is taken inside this transaction, under the same per-player
   * game lock and the same account row lock as a settlement, by the same guard
   * that authorizes settlement. A row that belongs to another owner or game, an
   * already-cancelled row and a row whose origin is still valid are all left
   * untouched, so a caller can never erase or mutate another key.
   */
  async cancelPrepared(gameId: string, userId: string, requestKey: string) {
    await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, gameId, userId);
        const row = await tx.gamePreparedOutcome.findUnique({ where: { requestKey } });
        if (!row || row.userId !== userId || row.gameId !== gameId || row.cancelledAt) return;
        const verdict = await this.guard.originStateIn(tx, {
          gameId,
          userId,
          sessionId: row.sessionId,
        });
        if (verdict.usable) return;
        await tx.gamePreparedOutcome.updateMany({
          where: { requestKey, cancelledAt: null },
          data: { cancelledAt: new Date(), cancelledReason: verdict.reason },
        });
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }
}
