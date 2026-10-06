import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  canManageRole,
  capabilityForRoleGrant,
  hasCapability,
  isProtectedHighRole,
  type Capability,
} from './capabilities';

export type ActorIdentity = { id: string; role: Role };
export type ManagedUser = { id: string; email: string; role: Role; disabled: boolean };

/** One shared advisory-lock key for every write that can remove protected capacity. */
export const SUPER_ADMIN_LOCK_KEY = 'casino:rbac:super-admin';

/**
 * Central, database-backed authorization.
 *
 * Every privileged operation re-reads the actor's role and account status from
 * the database inside the operation, so a demoted or disabled account's live
 * JWT cannot carry stale authority. Target-role checks live here too, so an
 * ADMIN can never manage a higher-role account through any path.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Re-read the actor and require a capability; audit and refuse otherwise. */
  async authorize(actorId: string, capability: Capability, operation: string): Promise<ActorIdentity> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, role: true, disabled: true },
    });
    if (!actor || actor.disabled || !hasCapability(actor.role, capability)) {
      await this.prisma.auditLog.create({
        data: {
          actorId: actor?.id ?? null,
          targetType: 'AUTHORIZATION',
          targetId: operation,
          action: 'PERMISSION_DENIED',
          result: 'DENIED',
          metadata: { operation, capability, role: actor?.role ?? null, disabled: actor?.disabled ?? null },
        },
      });
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You are not allowed to perform this operation.' });
    }
    return { id: actor.id, role: actor.role };
  }

  /**
   * Change a user's role under the shared super-admin lock.
   *
   * Rules enforced here (authoritative, not just on a route):
   *  - the actor must hold USER_MANAGE, and the *new* role's manage capability;
   *  - an ADMIN may only manage USER targets; SUPER_ADMIN may manage any;
   *  - a caller may never grant themselves a higher role (no self-promotion);
   *  - demoting the last active SUPER_ADMIN is refused.
   */
  async changeRole(actorId: string, targetUserId: string, newRole: Role): Promise<ManagedUser> {
    if (![Role.USER, Role.ADMIN, Role.SUPER_ADMIN].includes(newRole)) {
      throw new BadRequestException({ code: 'INVALID_ROLE', message: 'Unknown role.' });
    }
    // The actor must at least be able to manage users.
    await this.authorize(actorId, 'USER_MANAGE', 'USER_ROLE_CHANGE');
    return withSerializationConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUPER_ADMIN_LOCK_KEY}))`;
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, disabled: true } });
        const target = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, email: true, role: true, disabled: true },
        });
        if (!actor || actor.disabled) throw new ForbiddenException('FORBIDDEN');
        if (!target) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No such user.' });
        if (actor.id === target.id && roleRank(newRole) > roleRank(actor.role)) {
          // Self-promotion (including granting yourself a higher role) is refused;
          // a higher role is granted by someone who already holds the authority.
          throw new ForbiddenException({ code: 'SELF_PROMOTION_FORBIDDEN', message: 'You cannot grant yourself a higher role.' });
        }
        // Target must be within the actor's reach, and the actor must hold the
        // capability the *new* role requires.
        if (!canManageRole(actor.role, target.role)) {
          throw new ForbiddenException({ code: 'TARGET_ROLE_FORBIDDEN', message: 'You cannot manage that account.' });
        }
        if (!hasCapability(actor.role, capabilityForRoleGrant(newRole))) {
          throw new ForbiddenException({ code: 'ROLE_GRANT_FORBIDDEN', message: 'You cannot grant that role.' });
        }
        if (target.role !== newRole && isProtectedHighRole(target.role)) {
          await assertNotLastActiveSuperAdmin(tx, target.id);
        }
        const demotion = roleRank(newRole) < roleRank(target.role);
        const updated = await tx.user.update({
          where: { id: target.id },
          data: { role: newRole },
          select: { id: true, email: true, role: true, disabled: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            targetType: 'USER',
            targetId: target.id,
            // Demotion is its own action so the audit trail reads truthfully.
            action: demotion ? 'ADMIN_ROLE_REVOKED' : 'ADMIN_ROLE_GRANTED',
            result: 'SUCCESS',
            metadata: { from: target.role, to: newRole },
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }

  /**
   * Enable or disable an account under the shared super-admin lock.
   *
   * An ADMIN may only disable USER targets; disabling the last active
   * SUPER_ADMIN is refused; a caller may not disable themselves.
   */
  async setDisabled(actorId: string, targetUserId: string, disabled: boolean): Promise<ManagedUser> {
    await this.authorize(actorId, 'USER_MANAGE', disabled ? 'USER_DISABLE' : 'USER_ENABLE');
    return withSerializationConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SUPER_ADMIN_LOCK_KEY}))`;
        const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, disabled: true } });
        const target = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, email: true, role: true, disabled: true },
        });
        if (!actor || actor.disabled) throw new ForbiddenException('FORBIDDEN');
        if (!target) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No such user.' });
        if (actor.id === target.id && disabled) {
          throw new ForbiddenException({ code: 'SELF_DISABLE_FORBIDDEN', message: 'You cannot disable your own account.' });
        }
        if (!canManageRole(actor.role, target.role)) {
          throw new ForbiddenException({ code: 'TARGET_ROLE_FORBIDDEN', message: 'You cannot manage that account.' });
        }
        if (disabled && !target.disabled && isProtectedHighRole(target.role)) {
          await assertNotLastActiveSuperAdmin(tx, target.id);
        }
        const updated = await tx.user.update({
          where: { id: target.id },
          data: { disabled },
          select: { id: true, email: true, role: true, disabled: true },
        });
        if (disabled) {
          // Same transaction as the status change: a disabled account can no
          // longer rotate any refresh token, and cannot be revived by one.
          await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            targetType: 'USER',
            targetId: target.id,
            action: 'ADMIN_USER_STATUS_CHANGED',
            result: disabled ? 'DISABLED' : 'ENABLED',
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
  }
}

/**
 * Refuse an operation that would leave zero active SUPER_ADMINs.
 *
 * Callers MUST already hold the shared `SUPER_ADMIN_LOCK_KEY` advisory lock in
 * the same transaction, so two concurrent removals serialise and the second
 * sees the first's effect rather than both reading the same non-zero count.
 */
export async function assertNotLastActiveSuperAdmin(tx: Prisma.TransactionClient, targetUserId: string): Promise<void> {
  const remaining = await tx.user.count({
    where: { role: Role.SUPER_ADMIN, disabled: false, id: { not: targetUserId } },
  });
  if (remaining === 0) {
    throw new ConflictException({
      code: 'LAST_SUPER_ADMIN_REQUIRED',
      message: 'The last active SUPER_ADMIN cannot be demoted or disabled.',
    });
  }
}

/**
 * Map a Prisma serialization conflict to a deterministic HTTP 409.
 *
 * The shared super-admin lock already serialises removals, but a serializable
 * transaction can still surface P2034 under contention. There is deliberately
 * no retry loop: the caller gets a clear conflict and may retry.
 */
export async function withSerializationConflict<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new ConflictException({
        code: 'SERIALIZATION_CONFLICT',
        message: 'A concurrent change interfered with this operation; please retry.',
      });
    }
    throw error;
  }
}

function roleRank(role: Role): number {
  if (role === Role.SUPER_ADMIN) return 2;
  if (role === Role.ADMIN) return 1;
  return 0;
}
