import { randomInt, randomUUID } from 'node:crypto';
import { CasinoGameType } from '@prisma/client';
import { PrismaService } from '../../src/prisma.service';
import {
  GameActionContext,
  GameAdapter,
  GamePlatform,
  GameRequest,
  ReadClient,
  TransactionClient,
} from '../../src/casino/platform/game-adapter.types';

/**
 * Architectural proof, not a product.
 *
 * A complete second game integration written against nothing but the shared
 * layer. It has its own id, its own events (`flip`, `getState`), its own
 * canonical semantics, its own round projection and its own recovery payload,
 * and it reuses the platform's launch capability, session binding, wallet,
 * ledger, idempotency, prepared-outcome journal and round ownership without
 * changing a single line of `src/casino/platform`.
 */
export const COIN_FLIP_GAME_ID = 'coin-flip-fixture';
export const COIN_FLIP_STAKE = 1n;
export const COIN_FLIP_PAYOUT = 2n;

type Side = 'heads' | 'tails';

type CoinFlipRound = {
  roundId: string;
  stake: number;
  choice: Side;
  draw: Side;
  payout: number;
};

const SIDES: Side[] = ['heads', 'tails'];

export class CoinFlipAdapter implements GameAdapter {
  readonly gameId = COIN_FLIP_GAME_ID;

  readonly readOnlyEvents = ['getState'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: GamePlatform,
  ) {}

  private get journal() {
    return this.platform.journal;
  }

  private get wallet() {
    return this.platform.wallet;
  }

  private get rounds() {
    return this.platform.rounds;
  }

  validateRequest(body: Record<string, unknown>) {
    const event = typeof body?.slotEvent === 'string' ? body.slotEvent : '';
    if (event !== 'flip' && event !== 'getState') {
      throw new Error(`unsupported fixture event: ${event}`);
    }
    return event;
  }

  canonicalizeAction(context: GameActionContext, event: string, body: Record<string, unknown>) {
    const choice = event === 'flip' ? this.parseChoice(body) : null;
    return JSON.stringify({ event, player: context.userId, choice }, ['event', 'player', 'choice']);
  }

  async read(context: GameActionContext, event: string, _body: Record<string, unknown>) {
    if (event !== 'getState') {
      throw new Error(`unsupported fixture read: ${event}`);
    }
    return { responseEvent: 'state', recovery: await this.snapshot(context.userId) };
  }

  async execute(context: GameActionContext, request: GameRequest) {
    const { userId } = context;
    const canonical = this.canonicalizeAction(context, request.event, request.body);
    const replay = await this.journal.findReplay(this.gameId, userId, request.requestId, canonical);
    if (replay) return replay;
    await this.reconcilePrepared(context);
    const settled = await this.journal.findReplay(this.gameId, userId, request.requestId, canonical);
    if (settled) return settled;

    const choice = this.parseChoice(request.body);
    await this.journal.serialized(this.gameId, userId, async (tx) => {
      const key = this.journal.requestKey(userId, request.requestId);
      const existing = await this.journal.findPreparedIn(tx, key, userId);
      if (existing) {
        if (existing.canonical !== canonical) this.journal.conflictSemantics();
        return;
      }
      // The outcome is drawn once and committed before any money moves.
      const round: CoinFlipRound = {
        roundId: randomUUID(),
        stake: Number(COIN_FLIP_STAKE),
        choice,
        draw: SIDES[randomInt(0, SIDES.length)],
        payout: 0,
      };
      round.payout = round.draw === round.choice ? Number(COIN_FLIP_PAYOUT) : 0;
      await this.journal.prepareOutcome(tx, {
        gameId: this.gameId,
        userId,
        requestKey: key,
        kind: 'flip',
        canonical,
        sessionId: context.sessionId,
        actionId: request.requestId,
        originRoundId: 'none',
        originVersion: 1,
        originPhase: 'IDLE',
        body: request.body,
        payload: round,
      });
    });
    return this.settlePrepared(userId, request.requestId, canonical);
  }

  async reconcilePrepared(context: GameActionContext) {
    const rows = await this.journal.listPrepared(context.userId, this.gameId);
    for (const row of rows) {
      const requestId = this.journal.unscopedRequestId(context.userId, row.requestKey);
      const prepared = await this.journal.findPrepared(context.userId, row.requestKey);
      await this.settlePrepared(context.userId, requestId, prepared?.canonical ?? '');
    }
  }

  /** The same shape every adapter settles with: stored outcome, never a redraw. */
  private async settlePrepared(userId: string, requestId: string, canonical: string) {
    return this.journal.serialized(this.gameId, userId, async (tx) => {
      const key = this.journal.requestKey(userId, requestId);
      const replay = await this.journal.findReplayIn(tx, this.gameId, userId, requestId, canonical);
      if (replay) {
        await this.journal.deletePrepared(tx, key);
        return replay;
      }
      const prepared = await this.journal.findPreparedIn(tx, key, userId);
      if (!prepared) throw this.journal.conflict('OUTCOME_NOT_PREPARED', 'The prepared outcome is missing.');
      const round = prepared.payload as CoinFlipRound;
      const created = await this.rounds.createRound(tx, {
        id: round.roundId,
        userId,
        gameId: this.gameId,
        gameType: CasinoGameType.DICE,
        gameVersion: `${this.gameId}.v1`,
        stake: BigInt(round.stake),
        publicState: { gameId: this.gameId, draw: round.draw, choice: round.choice },
        privateState: round,
        clientSeed: `${this.gameId}:${round.roundId}`,
      });
      await this.wallet.debit(tx, {
        walletId: await this.walletId(tx, userId),
        userId,
        roundId: created.id,
        amount: BigInt(round.stake),
        reason: 'Coin flip stake',
        key: `casino:${this.gameId}:bet:${created.id}`,
        sessionId: prepared.sessionId,
        actionId: prepared.actionId,
      });
      if (round.payout > 0) {
        await this.wallet.credit(tx, {
          walletId: await this.walletId(tx, userId),
          userId,
          roundId: created.id,
          amount: BigInt(round.stake * 2),
          reason: 'Coin flip payout',
          key: `casino:${this.gameId}:win:${created.id}`,
          sessionId: prepared.sessionId,
          actionId: prepared.actionId,
        });
      }
      await this.rounds.persistRound(tx, created, {
        status: round.payout > 0 ? 'CASHED_OUT' : 'LOST',
        payout: BigInt(round.payout),
        publicState: { gameId: this.gameId, draw: round.draw, choice: round.choice },
        privateState: round,
        settled: true,
      });
      const stored = await this.journal.bookAction(tx, {
        gameId: this.gameId,
        userId,
        roundId: created.id,
        event: 'flip',
        requestId,
        canonical,
        response: {
          responseEvent: 'flip',
          serverResponse: { draw: round.draw, choice: round.choice, payout: round.payout },
          recovery: await this.snapshotIn(tx, userId, created.id),
        },
      });
      await this.journal.deletePrepared(tx, key);
      return stored;
    });
  }

  private async walletId(tx: TransactionClient, userId: string) {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId }, select: { id: true } });
    return wallet.id;
  }

  private async snapshot(userId: string) {
    const round = await this.rounds.currentRound(this.prisma as unknown as ReadClient, this.gameId, userId);
    return this.snapshotIn(this.prisma as unknown as ReadClient, userId, round?.id ?? null);
  }

  private async snapshotIn(db: ReadClient, userId: string, roundId: string | null) {
    const receipt = await this.journal.receipt(db, this.gameId, userId);
    const balance = await this.wallet.balancePoints(db, userId);
    return { roundId: roundId ?? 'none', balance, actionId: receipt.actionId, receipt };
  }

  private parseChoice(body: Record<string, unknown>): Side {
    const choice = typeof body?.choice === 'string' ? body.choice : '';
    if (!SIDES.includes(choice as Side)) {
      throw this.journal.conflict('INVALID_CHOICE', 'Choose heads or tails.');
    }
    return choice as Side;
  }
}
