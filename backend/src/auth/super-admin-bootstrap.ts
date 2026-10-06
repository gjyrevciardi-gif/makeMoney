import { Prisma, Role } from '@prisma/client';
import { SUPER_ADMIN_LOCK_KEY } from './authorization.service';

/**
 * First-SUPER_ADMIN recovery bootstrap.
 *
 * A controlled, one-account recovery path for a fresh deployment: it can
 * promote an existing *active ADMIN* to SUPER_ADMIN only when no active
 * SUPER_ADMIN exists yet. It never creates a user, never changes a password,
 * never auto-promotes, and records every promotion in AuditLog.
 *
 * All three facts (the target's role/status, the active SUPER_ADMIN count, and
 * the update) are read and written inside ONE transaction holding the same
 * shared super-admin advisory lock the removal paths use, so a concurrent
 * promotion/removal cannot race it.
 */
export type BootstrapOutcome =
  | { status: 'PROMOTED'; email: string; from: Role }
  | { status: 'NOOP'; email: string; reason: 'ALREADY_SUPER_ADMIN' }
  | { status: 'REFUSED'; email: string; code: 'USER_NOT_FOUND' | 'SUPER_ADMIN_ALREADY_EXISTS' | 'ACTIVE_ADMIN_REQUIRED'; message: string };

/** Minimal client seam so the command logic can be unit-tested with a mock. */
export type BootstrapClient = {
  $transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<T>;
};

export async function bootstrapSuperAdmin(client: BootstrapClient, email: string): Promise<BootstrapOutcome> {
  const normalized = email.trim().toLowerCase();
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUPER_ADMIN_LOCK_KEY}))`;
    const user = await tx.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, role: true, disabled: true },
    });
    if (!user) {
      return { status: 'REFUSED', email: normalized, code: 'USER_NOT_FOUND', message: `No existing user with email ${normalized}.` };
    }
    if (user.role === Role.SUPER_ADMIN) {
      // Re-running the same request for the same account is a safe no-op.
      return { status: 'NOOP', email: normalized, reason: 'ALREADY_SUPER_ADMIN' };
    }
    const activeSuperAdmins = await tx.user.count({ where: { role: Role.SUPER_ADMIN, disabled: false } });
    if (activeSuperAdmins > 0) {
      return {
        status: 'REFUSED',
        email: normalized,
        code: 'SUPER_ADMIN_ALREADY_EXISTS',
        message: 'An active SUPER_ADMIN already exists; further grants go through the authorized role service.',
      };
    }
    if (user.role !== Role.ADMIN || user.disabled) {
      return {
        status: 'REFUSED',
        email: normalized,
        code: 'ACTIVE_ADMIN_REQUIRED',
        message: 'The bootstrap only promotes an existing, active ADMIN account.',
      };
    }
    await tx.user.update({ where: { id: user.id }, data: { role: Role.SUPER_ADMIN } });
    await tx.auditLog.create({
      data: {
        actorId: null,
        targetType: 'USER',
        targetId: user.id,
        action: 'ADMIN_ROLE_GRANTED',
        result: 'SUCCESS',
        metadata: { from: user.role, to: 'SUPER_ADMIN', source: 'bootstrap-super-admin' },
      },
    });
    return { status: 'PROMOTED', email: normalized, from: user.role };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
