import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { NewRound, ReadClient, RoundProjection, RoundRow, TransactionClient } from './game-adapter.types';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * The authoritative round record for an integrated game.
 *
 * A round belongs to exactly one player and one game; the hidden game state and
 * the projected public state are both produced by the game adapter, so the
 * platform stores and scopes them without knowing what they contain. Rounds are
 * found by their game-version prefix, which is what keeps two integrated games
 * from ever reading each other's round.
 */
@Injectable()
export class GameRoundService {
  constructor(private readonly prisma: PrismaService) {}

  private versionPrefix(gameId: string) {
    return `${gameId}.`;
  }

  currentRoundWhere(gameId: string, userId: string) {
    return { userId, gameVersion: { startsWith: this.versionPrefix(gameId) } };
  }

  async currentRound(db: ReadClient, gameId: string, userId: string): Promise<RoundRow | null> {
    return db.casinoRound.findFirst({
      where: this.currentRoundWhere(gameId, userId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async currentRoundIn(tx: TransactionClient, gameId: string, userId: string): Promise<RoundRow | null> {
    return this.currentRound(tx, gameId, userId);
  }

  async createRound(tx: TransactionClient, params: NewRound) {
    // Outcome entropy is the caller's CSPRNG; this value is an opaque per-round
    // reference recorded for auditability, not a seed that reproduces a result.
    const reference = randomBytes(32).toString('hex');
    return tx.casinoRound.create({
      data: {
        id: params.id,
        userId: params.userId,
        gameType: params.gameType,
        gameVersion: params.gameVersion,
        // Always opened as OPEN; the adapter settles the terminal columns in the
        // same transaction once the wallet movement has happened.
        status: 'OPEN',
        stake: params.stake,
        multiplier: null,
        payout: 0n,
        serverSeed: reference,
        serverSeedHash: sha256(reference),
        clientSeed: params.clientSeed,
        nonce: 0,
        publicState: params.publicState as Prisma.InputJsonValue,
        privateState: params.privateState as Prisma.InputJsonValue,
        idempotencyKey: `casino:${params.gameId}:round:${params.id}`,
        settledAt: null,
      },
    });
  }

  async persistRound(tx: TransactionClient, round: { id: string; settledAt: Date | null }, params: RoundProjection) {
    await tx.casinoRound.update({
      where: { id: round.id },
      data: {
        status: params.status,
        payout: params.payout,
        publicState: params.publicState as Prisma.InputJsonValue,
        privateState: params.privateState as Prisma.InputJsonValue,
        settledAt: params.settled ? (round.settledAt ?? new Date()) : null,
      },
    });
  }

  /** Ownership-scoped lookup: another player's round is simply not found. */
  async ownedRound(userId: string, gameId: string, roundId: string) {
    const round = await this.prisma.casinoRound.findFirst({
      where: { id: roundId, userId, gameVersion: { startsWith: this.versionPrefix(gameId) } },
    });
    if (!round) throw new NotFoundException({ code: 'ROUND_NOT_FOUND', message: 'Round not found.' });
    return round;
  }
}
