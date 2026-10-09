import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { canManageUser, hasCapability, REACH_SELECT } from '../auth/capabilities';
import { recordSecurityEvent, recordWinIfLarge } from '../security/security-events';

const MAX_MUTATION = 1_000_000_000n;

@Injectable()
export class PointsService {
  constructor(private readonly prisma: PrismaService) {}

  async adminGrant(actorId: string, targetUserId: string, amount: bigint, reason: string, idempotencyKey: string) {
    if (amount <= 0n || amount > MAX_MUTATION) throw new BadRequestException('INVALID_AMOUNT');
    if (!reason.trim()) throw new BadRequestException('REASON_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      // Authorize the actor's current role, the target's role, and the target
      // wallet INSIDE this transaction, before the idempotency check, so a
      // downgraded actor or a forbidden/cross-target replay can never read or
      // return another entry.
      const { wallet } = await this.authorizeMutation(tx, actorId, targetUserId, 'ADMIN_COIN_GRANT');
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) {
        this.assertIdempotentReplay(existing, {
          actorId,
          walletId: wallet.id,
          type: 'ADMIN_GRANT',
          amount,
          reason: reason.trim(),
        });
        return { ledgerEntryId: existing.id, duplicate: true };
      }
      const entry = await tx.ledgerEntry.create({ data: { walletId: wallet.id, type: 'ADMIN_GRANT', amount, reason: reason.trim(), actorId, idempotencyKey } });
      const credited = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } });
      await recordSecurityEvent(tx, { type: 'PTS_GRANTED', subjectUserId: targetUserId, actorId, amount, balanceAfter: credited.balance, reason: reason.trim(), refType: 'LEDGER', refId: entry.id });
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
    return this.prisma.$transaction(async (tx) => {
      const { wallet } = await this.authorizeMutation(tx, actorId, targetUserId, 'ADMIN_COIN_REMOVE');
      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey } });
      if (existing) {
        this.assertIdempotentReplay(existing, {
          actorId,
          walletId: wallet.id,
          type: 'ADMIN_REMOVE',
          amount: -amount,
          reason: reason.trim(),
        });
        return { ledgerEntryId: existing.id, duplicate: true };
      }
      const debited = await tx.wallet.updateMany({ where: { id: wallet.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (debited.count !== 1) throw new ConflictException('INSUFFICIENT_VIRTUAL_BALANCE');
      const entry = await tx.ledgerEntry.create({ data: { walletId: wallet.id, type: 'ADMIN_REMOVE', amount: -amount, reason: reason.trim(), actorId, idempotencyKey } });
      const after = await tx.wallet.findUnique({ where: { id: wallet.id }, select: { balance: true } });
      await recordSecurityEvent(tx, { type: 'PTS_REMOVED', subjectUserId: targetUserId, actorId, amount, balanceAfter: after?.balance, reason: reason.trim(), refType: 'LEDGER', refId: entry.id });
      await tx.auditLog.create({ data: { actorId, targetId: targetUserId, action: 'ADMIN_COIN_REMOVE', result: 'SUCCESS', metadata: { amount: amount.toString(), reason: reason.trim(), idempotencyKey } } });
      return { ledgerEntryId: entry.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * A manager moves points they already hold. `give` pays one of their players from the manager's own
   * balance; `take` returns points from that player to the manager. No point is created or destroyed:
   * the two ledger entries cancel, both wallets are locked in a fixed order, and the paying wallet can
   * never go negative. A retry with the same key is a no-op.
   */
  async managerTransfer(
    actorId: string,
    targetUserId: string,
    amount: bigint,
    reason: string,
    idempotencyKey: string,
    direction: 'give' | 'take',
  ) {
    if (amount <= 0n || amount > MAX_MUTATION) throw new BadRequestException('INVALID_AMOUNT');
    if (!reason.trim()) throw new BadRequestException('REASON_REQUIRED');
    const note = reason.trim();
    return this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, disabled: true } });
      const denied = async (why: string, extra: Record<string, unknown> = {}) => {
        await tx.auditLog.create({ data: { actorId, targetType: 'USER', targetId: targetUserId, action: 'PERMISSION_DENIED', result: 'DENIED', metadata: { operation: 'PTS_TRANSFER', reason: why, ...extra } } });
        throw new ForbiddenException(why);
      };
      if (!actor || actor.disabled || !hasCapability(actor.role, 'PLAYER_POINTS_TRANSFER')) return denied('MANAGER_REQUIRED');
      const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true, ...REACH_SELECT } });
      if (!target) throw new NotFoundException('USER_NOT_FOUND');
      if (target.role !== Role.USER || !canManageUser(actor, target)) return denied('TARGET_ROLE_FORBIDDEN', { targetRole: target.role });
      const [managerWallet, playerWallet] = await Promise.all([
        tx.wallet.findUnique({ where: { userId: actorId } }),
        tx.wallet.findUnique({ where: { userId: targetUserId } }),
      ]);
      if (!managerWallet || !playerWallet) throw new NotFoundException('WALLET_NOT_FOUND');
      const from = direction === 'give' ? managerWallet : playerWallet;
      const to = direction === 'give' ? playerWallet : managerWallet;
      const outKey = `${idempotencyKey}:out`;
      const inKey = `${idempotencyKey}:in`;

      const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: outKey } });
      if (existing) {
        this.assertIdempotentReplay(existing, { actorId, walletId: from.id, type: 'TRANSFER_OUT', amount: -amount, reason: note });
        return { duplicate: true };
      }
      // Fixed order, so two opposite transfers can never wait on each other.
      await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" IN (${from.id}::uuid, ${to.id}::uuid) ORDER BY "id" FOR UPDATE`;
      const debited = await tx.wallet.updateMany({ where: { id: from.id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });
      if (debited.count !== 1) throw new ConflictException('INSUFFICIENT_VIRTUAL_BALANCE');
      const credited = await tx.wallet.update({ where: { id: to.id }, data: { balance: { increment: amount } } });
      const out = await tx.ledgerEntry.create({ data: { walletId: from.id, type: 'TRANSFER_OUT', amount: -amount, reason: note, actorId, idempotencyKey: outKey } });
      await tx.ledgerEntry.create({ data: { walletId: to.id, type: 'TRANSFER_IN', amount, reason: note, actorId, idempotencyKey: inKey } });

      const playerBalance = direction === 'give' ? credited.balance : (await tx.wallet.findUniqueOrThrow({ where: { id: from.id } })).balance;
      await recordSecurityEvent(tx, {
        type: direction === 'give' ? 'PTS_TRANSFERRED' : 'PTS_RECLAIMED',
        subjectUserId: targetUserId,
        actorId,
        amount,
        balanceAfter: playerBalance,
        reason: note,
        refType: 'LEDGER',
        refId: out.id,
      });
      await tx.auditLog.create({ data: { actorId, targetType: 'USER', targetId: targetUserId, action: 'PTS_TRANSFER', result: 'SUCCESS', metadata: { direction, amount: amount.toString(), reason: note, idempotencyKey } } });
      return { ledgerEntryId: out.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  /**
   * Re-read the actor's *current* role/status inside the mutation transaction,
   * require PLAYER_POINTS_MANAGE, enforce the target-role contract, and resolve
   * the target wallet. A demoted or disabled administrator, or an ADMIN aiming
   * at a higher-role account, is refused before any ledger read.
   */
  private async authorizeMutation(
    tx: Prisma.TransactionClient,
    actorId: string,
    targetUserId: string,
    action: string,
  ) {
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, disabled: true },
    });
    if (!actor || actor.disabled || !hasCapability(actor.role, 'PLAYER_POINTS_MANAGE')) {
      await tx.auditLog.create({ data: { actorId, targetType: 'USER', targetId: targetUserId, action: 'PERMISSION_DENIED', result: 'DENIED', metadata: { operation: action } } });
      throw new ForbiddenException('ADMIN_REQUIRED');
    }
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true, ...REACH_SELECT } });
    if (!target) throw new NotFoundException('USER_NOT_FOUND');
    if (!canManageUser(actor, target)) {
      await tx.auditLog.create({ data: { actorId, targetType: 'USER', targetId: targetUserId, action: 'PERMISSION_DENIED', result: 'DENIED', metadata: { operation: action, reason: 'TARGET_ROLE_FORBIDDEN', targetRole: target.role } } });
      throw new ForbiddenException('TARGET_ROLE_FORBIDDEN');
    }
    const wallet = await tx.wallet.findUnique({ where: { userId: targetUserId } });
    if (!wallet) throw new NotFoundException('WALLET_NOT_FOUND');
    return { actor, target, wallet };
  }

  /**
   * A replay is valid only when the stored entry is exactly the mutation being
   * retried: same actor, same target wallet, same action type, amount and
   * reason. Anything else is a conflict and must not disclose the other entry.
   */
  private assertIdempotentReplay(
    existing: { actorId: string | null; walletId: string; type: string; amount: bigint; reason: string | null },
    expected: { actorId: string; walletId: string; type: string; amount: bigint; reason: string },
  ) {
    const matches =
      existing.actorId === expected.actorId &&
      existing.walletId === expected.walletId &&
      existing.type === expected.type &&
      existing.amount === expected.amount &&
      existing.reason === expected.reason;
    if (!matches) {
      throw new ConflictException({ code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'This idempotency key was used for a different mutation.' });
    }
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
      const credited = await tx.wallet.findUnique({ where: { id: bet.user.wallet.id }, select: { balance: true } });
      await recordWinIfLarge(tx, { userId: bet.userId, amount: bet.potentialPayout, balanceAfter: credited?.balance, refType: 'BET', refId: bet.id });
      await tx.auditLog.create({ data: { targetId: bet.id, action: 'BET_SETTLED', result: 'WON' } });
      return { ledgerEntryId: entry.id, duplicate: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
