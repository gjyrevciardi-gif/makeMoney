import { Prisma } from '@prisma/client';

/**
 * Retire every game credential a user holds, inside the caller's transaction.
 *
 * Game access is bound to `User.authVersion` (see
 * `docs/SECURITY-GAME-SESSION-REVOCATION-A2.md`). The callers of this helper -
 * all-devices logout, an administrator password reset, a self password change
 * and an account disable - have already incremented that counter in the same
 * transaction, which is what invalidates every bound launch capability and
 * every bound game session; this marks the still-active sessions as revoked so
 * the durable state says so plainly instead of only implying it through the
 * version.
 *
 * It deliberately deletes nothing and touches no financial data: a launch
 * capability that is no longer exchangeable stays on record, and a game session
 * that is revoked keeps its identity, so rounds, ledger entries and audit rows
 * that reference it stay readable.
 */
export async function revokeGameCredentials(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx.gameSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}
