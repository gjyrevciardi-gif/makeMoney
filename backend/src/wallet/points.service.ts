import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const MAX_MUTATION = 1_000_000_000n;

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  async adminGrant(actorId: string, targetUserId: string, amount: bigint, reason: string, idempotencyKey: string) {
    if (amount <= 0n || amount > MAX_MUTATION) throw new BadRequestException('INVALID_AMOUNT');
    if (!reason.trim()) throw new BadRequestException('REASON_REQUIRED');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (actor?.role !== Role.ADMIN) {
      await this.prisma.auditLog.create({ data: { actorId, targetType: 'USER', targetId: targetUserId, action: 'PERMISSION_DENIED', result: 'DENIED' } });
      throw new ForbiddenException('ADMIN_REQUIRED');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) return { ledgerEntryId: existing.id, duplicate: true };
      const wallet = await tx.wallet.findUnique({ where: { userId: targetUserId } });
      if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
      const entry = await tx.ledgerEntry.create({ data: { walletId: wallet.id, type: 'ADMIN_GRANT', amount, reason: reason.trim(), actorId, idempotencyKey } });
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } });
      await tx.auditLog.create({ data: { actorId, targetId: targetUserId, action: 'ADMIN_COIN_GRANT', result: 'SUCCESS', metadata: { amount: amount.toString(), reason: reason.trim(), idempotencyKey } } });
      return { ledgerEntryId: entry.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Removes virtual points through the immutable ledger.
   *
   * There is deliberately no way to assign a balance directly: every point a
   * wallet holds is explained by a ledger entry, so a removal is a conditional
   * debit that simply fails when the wallet cannot cover it. The database
   * additionally refuses any negative balance.
   */
  async adminRemove(actorId: string, targetUserId: string, amount: bigint, reason: string, idempotencyKey: string) {
    if (amount <= 0n || amount > MAX_MUTATION) throw new BadRequestException('INVALID_AMOUNT');
    if (!reason.trim()) throw new BadRequestException('REASON_REQUIRED');
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (actor?.role !== Role.ADMIN) {
      await this.prisma.auditLog.create({ data: { actorId, targetType: 'USER', targetId: targetUserId, action: 'PERMISSION_DENIED', result: 'DENIED' } });
      throw new ForbiddenException('ADMIN_REQUIRED');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) return { ledgerEntryId: existing.id, duplicate: true };
      const wallet = await tx.wallet.findUnique({ where: { userId: targetUserId } });
      if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
      const debited = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (debited.count !== 1) throw new ConflictException('INSUFFICIENT_VIRTUAL_BALANCE');
      const entry = await tx.ledgerEntry.create({ data: { walletId: wallet.id, type: 'ADMIN_REMOVE', amount: -amount, reason: reason.trim(), actorId, idempotencyKey } });
      await tx.auditLog.create({ data: { actorId, targetId: targetUserId, action: 'ADMIN_COIN_REMOVE', result: 'SUCCESS', metadata: { amount: amount.toString(), reason: reason.trim(), idempotencyKey } } });
      return { ledgerEntryId: entry.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async placeSportsBet(userId: string, stake: bigint, potentialPayout: bigint, idempotencyKey: string) {
    if (stake <= 0n || potentialPayout < stake) throw new BadRequestException('INVALID_BET');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.bet.findUnique({ where: { idempotencyKey } });
      if (existing) return existing;
      const wallet = await tx.wallet.findUnique({ where: { userId } });
      if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
      const debited = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: stake } }, data: { balance: { decrement: stake } } });
      if (debited.count !== 1) throw new ConflictException('INSUFFICIENT_VIRTUAL_BALANCE');
      const bet = await tx.bet.create({ data: { userId, stake, potentialPayout, idempotencyKey } });
      await tx.ledgerEntry.create({ data: { walletId: wallet.id, type: 'SPORTS_BET', amount: -stake, reason: 'Sports bet stake', relatedBetId: bet.id, idempotencyKey: `sports-bet:${idempotencyKey}` } });
      await tx.auditLog.create({ data: { actorId: userId, targetId: bet.id, action: 'BET_PLACED', result: 'SUCCESS' } });
      return bet;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async settleSportsWin(betId: string, idempotencyKey: string) {
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (prior) return { ledgerEntryId: prior.id, duplicate: true };
      const bet = await tx.bet.findUnique({ where: { id: betId }, include: { user: { include: { wallet: true } } } });
      if (!bet || !bet.user.wallet) throw new NotFoundException('BET_NOT_FOUND');
      if (bet.status !== 'OPEN') throw new ConflictException('BET_ALREADY_SETTLED');
      const entry = await tx.ledgerEntry.create({ data: { walletId: bet.user.wallet.id, type: 'SPORTS_WIN', amount: bet.potentialPayout, reason: 'Sportsbook winning payout', relatedBetId: bet.id, idempotencyKey } });
      await tx.wallet.update({ where: { id: bet.user.wallet.id }, data: { balance: { increment: bet.potentialPayout } } });
      await tx.bet.update({ where: { id: bet.id }, data: { status: 'WON', settledAt: new Date() } });
      await tx.auditLog.create({ data: { targetId: bet.id, action: 'BET_SETTLED', result: 'WON' } });
      return { ledgerEntryId: entry.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
