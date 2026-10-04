import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  GameReceipt,
  NewPreparedOutcome,
  PreparedOutcome,
  PreparedOutcomeSummary,
  ReadClient,
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
 * transaction-scoped advisory lock, keyed by game and player.
 */
@Injectable()
export class GameJournalService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** One transaction-scoped advisory lock serializes a player's whole game. */
  async serialized<T>(
    gameId: string,
    userId: string,
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, gameId, userId);
        return work(tx);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  }

  async findReplay(gameId: string, userId: string, requestId: string, canonical: string) {
    return this.findReplayIn(this.prisma as unknown as ReadClient, gameId, userId, requestId, canonical);
  }

  async findReplayIn(
    db: ReadClient,
    gameId: string,
    userId: string,
    requestId: string,
    canonical: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await db.casinoRoundAction.findUnique({ where: { idempotencyKey: this.requestKey(userId, requestId) } });
    if (!row) return null;
    if (row.gameId !== gameId) return null;
    if (row.canonical !== canonical) this.conflictSemantics();
    return row.payload as unknown as Record<string, unknown>;
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
  async acknowledge(gameId: string, userId: string, actionId: string) {
    return this.serialized(gameId, userId, async (tx) => {
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
    };
  }

  /**
   * A prepared outcome blocks any other mutation until its own request settles
   * it, which is what keeps two different actions from interleaving.
   */
  async assertNoForeignPrepared(tx: TransactionClient, gameId: string, userId: string, requestKey: string) {
    const row = await tx.gamePreparedOutcome.findFirst({
      where: { userId, gameId },
      select: { requestKey: true },
    });
    if (row && row.requestKey !== requestKey) {
      throw this.conflict('SETTLEMENT_PENDING', 'A prepared settlement is pending for another request.');
    }
  }

  async listPrepared(userId: string, gameId: string): Promise<PreparedOutcomeSummary[]> {
    return this.prisma.gamePreparedOutcome.findMany({
      where: { userId, gameId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { requestKey: true, kind: true },
    });
  }

  async deletePrepared(tx: TransactionClient, requestKey: string) {
    await tx.gamePreparedOutcome.deleteMany({ where: { requestKey } });
  }

  /**
   * Removes a superseded prepared outcome in its own transaction: the failed
   * settlement transaction rolled back, so the delete has to commit separately.
   */
  async discardPrepared(gameId: string, userId: string, requestKey: string) {
    await this.serialized(gameId, userId, async (tx) => {
      await this.deletePrepared(tx, requestKey);
    });
  }
}
