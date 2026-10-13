import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { AuthorizationService } from './authorization.service';
import { canManageUser, capabilityForRoleGrant, hasCapability } from './capabilities';
import { revokeGameCredentials } from './game-session-revocation';
import { recordSecurityEvent } from '../security/security-events';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
const USERNAME = /^[a-z0-9._-]{3,32}$/;
// No look-alike characters (0/O, 1/l/I): a generated password is read out or typed by a person.
const GENERATED_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const normalizeUsername = (value: string) => value.trim().toLowerCase();

export function generatePassword(length = 12): string {
  let out = '';
  for (let index = 0; index < length; index += 1) out += GENERATED_ALPHABET[randomInt(GENERATED_ALPHABET.length)];
  return out;
}

function assertUsername(raw: string): string {
  const username = normalizeUsername(raw);
  if (!USERNAME.test(username)) {
    throw new BadRequestException({
      code: 'USERNAME_INVALID',
      message: 'A username is 3-32 characters: letters, digits, dot, underscore or hyphen.',
    });
  }
  return username;
}

function assertPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new BadRequestException({
      code: 'PASSWORD_INVALID',
      message: `A password is ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`,
    });
  }
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const usernameTaken = () =>
  new ConflictException({ code: 'USERNAME_TAKEN', message: 'That username is already in use.' });

export type CreatedUser = {
  id: string;
  username: string;
  role: Role;
  /** Present only when the server generated the password. Shown once; never retrievable later. */
  generatedPassword?: string;
};

/**
 * Administrator-managed accounts: create, set password, rename.
 *
 * Authorization is re-read from the database on every call (a demoted or disabled
 * administrator is refused even with a live token) and the target-role contract of
 * `canManageRole` applies: an ADMIN reaches USER accounts only, a SUPER_ADMIN any.
 *
 * Only the Argon2id hash is persisted. No plaintext or reversibly encrypted copy of
 * a password is stored anywhere: audit rows and the retired `UserPasswordVault`
 * table never receive password material. A server-generated password is returned
 * by `createUser` exactly once, in the create response.
 */
@Injectable()
export class UserAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Re-read the actor inside `tx`; refuse a missing, disabled or under-privileged actor. */
  private async actorIn(tx: Prisma.TransactionClient, actorId: string) {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, disabled: true } });
    if (!actor || actor.disabled || !hasCapability(actor.role, 'USER_MANAGE')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You are not allowed to perform this operation.' });
    }
    return actor;
  }

  private async managedTargetIn(tx: Prisma.TransactionClient, actor: { id: string; role: Role }, targetId: string) {
    const target = await tx.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, email: true, role: true, disabled: true, createdById: true, createdBy: { select: { createdById: true } } },
    });
    // Out-of-reach targets read as "not found", so an ADMIN cannot even probe for a SUPER_ADMIN's id.
    if (!target || !canManageUser(actor, target)) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return target;
  }

  async createUser(
    actorId: string,
    input: { username: string; password?: string; role?: Role },
  ): Promise<CreatedUser> {
    await this.authorization.authorize(actorId, 'USER_MANAGE', 'USER_CREATE');
    const role = input.role ?? Role.USER;
    if (role === Role.SUPER_ADMIN) {
      throw new BadRequestException({
        code: 'ROLE_NOT_CREATABLE',
        message: 'A SUPER_ADMIN is not created here; promote an administrator with the audited bootstrap.',
      });
    }
    const username = assertUsername(input.username);
    const generated = input.password === undefined;
    const password = input.password ?? generatePassword();
    assertPassword(password);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const actor = await this.actorIn(tx, actorId);
        // The new role's own capability: only a SUPER_ADMIN may create an ADMIN.
        if (!hasCapability(actor.role, capabilityForRoleGrant(role))) {
          throw new ForbiddenException({ code: 'ROLE_GRANT_FORBIDDEN', message: 'You cannot create that role.' });
        }
        const user = await tx.user.create({
          data: { username, passwordHash, role, createdById: actor.id, wallet: { create: {} } },
          select: { id: true, username: true, role: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            targetType: 'USER',
            targetId: user.id,
            action: 'USER_CREATED',
            result: 'SUCCESS',
            metadata: { username, role, passwordGenerated: generated },
          },
        });
        return user;
      });
      return { id: created.id, username: created.username as string, role: created.role, ...(generated ? { generatedPassword: password } : {}) };
    } catch (error) {
      if (isUniqueViolation(error)) throw usernameTaken();
      throw error;
    }
  }

  /** Set (or reset) a user's password. Revokes every refresh token so old sessions cannot renew. */
  async setPassword(actorId: string, targetId: string, password: string): Promise<{ id: string }> {
    await this.authorization.authorize(actorId, 'USER_MANAGE', 'USER_PASSWORD_SET');
    assertPassword(password);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await this.prisma.$transaction(async (tx) => {
      const actor = await this.actorIn(tx, actorId);
      const target = await this.managedTargetIn(tx, actor, targetId);
      // Bump the session version with the hash change: every access token the
      // target holds stops working, every refresh token is revoked below, and
      // every bound game session and pending launch capability dies with it.
      await tx.user.update({ where: { id: target.id }, data: { passwordHash, authVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await revokeGameCredentials(tx, target.id);
      await tx.auditLog.create({
        data: { actorId: actor.id, targetType: 'USER', targetId: target.id, action: 'PASSWORD_SET_BY_ADMIN', result: 'SUCCESS' },
      });
    });
    return { id: targetId };
  }

  /**
   * A user changes their own password. The current one must be right, the new one must differ, every
   * session is signed out, and the administrators who can see this account are notified (never the password).
   */
  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    assertPassword(newPassword);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true, authVersion: true, disabled: true } });
    if (!user || user.disabled || !(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException({ code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is not correct.' });
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: 'Choose a password different from the current one.' });
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      // Compare-and-set under the account row lock: if a concurrent reset,
      // logout or status change moved the hash, version or disabled flag since
      // the check above, this fails closed instead of overwriting the newer
      // state from the stale proof. The version bump retires the caller's own
      // live access token (and every other device's) at the same commit.
      const updated = await tx.user.updateMany({
        where: { id: userId, passwordHash: user.passwordHash, authVersion: user.authVersion, disabled: false },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new BadRequestException({ code: 'CURRENT_PASSWORD_INVALID', message: 'The current password is not correct.' });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      // The version bump retires this user's game sessions and pending launch
      // capabilities at the same commit as the caller's own access token.
      await revokeGameCredentials(tx, userId);
      await tx.auditLog.create({ data: { actorId: userId, targetType: 'USER', targetId: userId, action: 'PASSWORD_CHANGED', result: 'SUCCESS' } });
      await recordSecurityEvent(tx, { type: 'PASSWORD_CHANGED', subjectUserId: userId, actorId: userId, amount: 0n });
    });
  }

  /** Give a player to an administrator. Only a SUPER_ADMIN may do this; the owner must be an ADMIN or SUPER_ADMIN. */
  async setOwner(actorId: string, targetId: string, ownerId: string) {
    await this.authorization.authorize(actorId, 'ADMIN_MANAGE', 'USER_OWNER_SET');
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.actorIn(tx, actorId);
      const target = await this.managedTargetIn(tx, actor, targetId);
      if (target.role !== Role.USER && target.role !== Role.MANAGER) {
        throw new BadRequestException({ code: 'OWNER_TARGET_NOT_USER', message: 'Only a player or a manager can be assigned.' });
      }
      const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true, role: true, disabled: true } });
      // A player may belong to a manager or an administrator; a manager only to an administrator.
      const allowed = target.role === Role.MANAGER ? [Role.ADMIN, Role.SUPER_ADMIN] : [Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
      if (!owner || owner.disabled || !allowed.includes(owner.role as 'MANAGER')) {
        throw new BadRequestException({ code: 'OWNER_INVALID', message: 'Choose an active manager or administrator as the owner.' });
      }
      await tx.user.update({ where: { id: target.id }, data: { createdById: owner.id } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          targetType: 'USER',
          targetId: target.id,
          action: 'USER_OWNER_CHANGED',
          result: 'SUCCESS',
          metadata: { to: owner.id },
        },
      });
      return { id: target.id, ownerId: owner.id };
    });
  }

  async setUsername(actorId: string, targetId: string, rawUsername: string) {
    await this.authorization.authorize(actorId, 'USER_MANAGE', 'USER_USERNAME_SET');
    const username = assertUsername(rawUsername);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const actor = await this.actorIn(tx, actorId);
        const target = await this.managedTargetIn(tx, actor, targetId);
        const updated = await tx.user.update({ where: { id: target.id }, data: { username }, select: { id: true, username: true } });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            targetType: 'USER',
            targetId: target.id,
            action: 'USER_USERNAME_CHANGED',
            result: 'SUCCESS',
            metadata: { from: target.username, to: username },
          },
        });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw usernameTaken();
      throw error;
    }
  }
}
