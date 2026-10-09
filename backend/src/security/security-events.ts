import { Prisma, SecurityEventType, SecuritySeverity } from '@prisma/client';

/** A single winning payout at or above these amounts raises a notification. Whole points. */
export const BIG_WIN_POINTS = 100n;
export const HUGE_WIN_POINTS = 200n;

type Input = {
  type: SecurityEventType;
  subjectUserId: string;
  actorId?: string | null;
  amount: bigint;
  balanceAfter?: bigint | null;
  reason?: string | null;
  refType?: string;
  refId?: string;
};

const SEVERITY: Record<SecurityEventType, SecuritySeverity> = {
  PTS_GRANTED: 'INFO',
  PTS_REMOVED: 'WARNING',
  BIG_WIN: 'WARNING',
  HUGE_WIN: 'ALERT',
  PASSWORD_CHANGED: 'WARNING',
  PTS_TRANSFERRED: 'INFO',
  PTS_RECLAIMED: 'INFO',
};

/**
 * Write a notification inside the caller's transaction, so it commits or rolls back together with the
 * money movement it describes. The subject's current owner is stored so an ADMIN's view can be scoped.
 */
export async function recordSecurityEvent(tx: Prisma.TransactionClient, input: Input): Promise<void> {
  const subject = await tx.user.findUnique({
    where: { id: input.subjectUserId },
    select: { createdById: true, createdBy: { select: { createdById: true } } },
  });
  await tx.securityEvent.create({
    data: {
      type: input.type,
      severity: SEVERITY[input.type],
      subjectUserId: input.subjectUserId,
      actorId: input.actorId ?? null,
      ownerAdminId: subject?.createdById ?? null,
      // For a manager's player this is the administrator who created that manager.
      topOwnerId: subject?.createdBy?.createdById ?? null,
      amount: input.amount,
      balanceAfter: input.balanceAfter ?? null,
      reason: input.reason ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    },
  });
}

/** Notify when one payout is large. Smaller payouts write nothing. */
export async function recordWinIfLarge(
  tx: Prisma.TransactionClient,
  win: { userId: string; amount: bigint; balanceAfter?: bigint | null; refType: string; refId: string },
): Promise<void> {
  if (win.amount < BIG_WIN_POINTS) return;
  await recordSecurityEvent(tx, {
    type: win.amount >= HUGE_WIN_POINTS ? 'HUGE_WIN' : 'BIG_WIN',
    subjectUserId: win.userId,
    amount: win.amount,
    balanceAfter: win.balanceAfter,
    refType: win.refType,
    refId: win.refId,
  });
}
