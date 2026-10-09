import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { PasswordVaultService } from './password-vault.service';
import { generateTotpSecret, matchTotp, otpauthUri } from './totp';

const ISSUER = 'Fools Gold';
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const generateRecoveryCode = () => {
  let out = '';
  for (let index = 0; index < 10; index += 1) out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return out;
};
const invalidCode = () => new UnauthorizedException({ code: 'INVALID_MFA_CODE', message: 'That code is not correct.' });
const normalizeRecovery = (value: string) => value.replace(/[\s-]/g, '').toUpperCase();
export const formatRecoveryCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;

/**
 * Google Authenticator (TOTP) for administrators.
 *
 * The secret is stored encrypted with the same server key as the password vault. A code works once
 * (replay-guarded by the last accepted step), and ten single-use recovery codes cover a lost phone.
 */
@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService, private readonly vault: PasswordVaultService) {}

  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.prisma.userTotp.findUnique({ where: { userId }, select: { enabledAt: true } });
    return Boolean(record?.enabledAt);
  }

  async status(userId: string) {
    const record = await this.prisma.userTotp.findUnique({ where: { userId }, select: { enabledAt: true } });
    const recoveryCodesLeft = record?.enabledAt ? await this.prisma.userRecoveryCode.count({ where: { userId, usedAt: null } }) : 0;
    return { enabled: Boolean(record?.enabledAt), recoveryCodesLeft };
  }

  /** Start enrolment: store a fresh pending secret and hand it back once for the authenticator app. */
  async beginSetup(userId: string) {
    this.vault.assertConfigured();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, username: true, email: true } });
    if (!user || user.role === Role.USER) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Two-factor is for administrators.' });
    if (await this.isEnabled(userId)) throw new ConflictException({ code: 'MFA_ALREADY_ENABLED', message: 'Two-factor is already on.' });
    const secret = generateTotpSecret();
    const sealed = this.vault.encrypt(userId, secret);
    await this.prisma.userTotp.upsert({
      where: { userId },
      create: { userId, ...sealed },
      update: { ...sealed, enabledAt: null, lastStep: null },
    });
    return { secret, otpauthUri: otpauthUri(user.username ?? user.email ?? userId, secret, ISSUER) };
  }

  /** Finish enrolment with a first valid code. Returns the recovery codes, shown exactly once. */
  async enable(userId: string, code: string): Promise<string[]> {
    const record = await this.prisma.userTotp.findUnique({ where: { userId } });
    if (!record || record.enabledAt) throw new BadRequestException({ code: 'MFA_SETUP_NOT_STARTED', message: 'Start setup first.' });
    const step = matchTotp(this.vault.decrypt(userId, record), code.trim(), null);
    if (step === null) throw new BadRequestException({ code: 'MFA_CODE_INVALID', message: 'That code is not correct.' });
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    const hashes = await Promise.all(codes.map((c) => argon2.hash(c, { type: argon2.argon2id })));
    await this.prisma.$transaction(async (tx) => {
      await tx.userTotp.update({ where: { userId }, data: { enabledAt: new Date(), lastStep: step } });
      await tx.userRecoveryCode.deleteMany({ where: { userId } });
      await tx.userRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) });
      await tx.auditLog.create({ data: { actorId: userId, targetType: 'USER', targetId: userId, action: 'MFA_ENABLED', result: 'SUCCESS' } });
    });
    return codes.map(formatRecoveryCode);
  }

  /** The second login step: a current authenticator code, or one unused recovery code. */
  async verifyLogin(userId: string, input: string): Promise<void> {
    const submitted = input.trim();
    const record = await this.prisma.userTotp.findUnique({ where: { userId } });
    if (!record?.enabledAt) throw invalidCode();

    if (/^\d{6}$/.test(submitted)) {
      const step = matchTotp(this.vault.decrypt(userId, record), submitted, record.lastStep);
      if (step !== null) {
        // Conditional on the step still being newer: two concurrent submissions of one code cannot both pass.
        const taken = await this.prisma.userTotp.updateMany({
          where: { userId, OR: [{ lastStep: null }, { lastStep: { lt: step } }] },
          data: { lastStep: step },
        });
        if (taken.count === 1) return;
      }
    } else {
      const normalized = normalizeRecovery(submitted);
      if (normalized.length === 10) {
        const unused = await this.prisma.userRecoveryCode.findMany({ where: { userId, usedAt: null } });
        for (const candidate of unused) {
          if (!(await argon2.verify(candidate.codeHash, normalized))) continue;
          const used = await this.prisma.userRecoveryCode.updateMany({ where: { id: candidate.id, usedAt: null }, data: { usedAt: new Date() } });
          if (used.count === 1) {
            await this.prisma.auditLog.create({ data: { actorId: userId, targetType: 'USER', targetId: userId, action: 'MFA_RECOVERY_USED', result: 'SUCCESS' } });
            return;
          }
        }
      }
    }
    await this.prisma.auditLog.create({ data: { actorId: userId, targetType: 'LOGIN', targetId: userId, action: 'MFA_LOGIN_FAILED', result: 'INVALID_CODE' } });
    throw invalidCode();
  }

  /** A SUPER_ADMIN clears another administrator's two-factor (lost phone and lost recovery codes). */
  async reset(actorId: string, targetId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, disabled: true } });
      if (!actor || actor.disabled || actor.role !== Role.SUPER_ADMIN) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only a super administrator can do this.' });
      if (actorId === targetId) throw new ForbiddenException({ code: 'MFA_SELF_RESET_FORBIDDEN', message: 'Use the server tool to reset your own two-factor.' });
      const target = await tx.user.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!target) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });
      await tx.userRecoveryCode.deleteMany({ where: { userId: targetId } });
      await tx.userTotp.deleteMany({ where: { userId: targetId } });
      await tx.refreshToken.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId, targetType: 'USER', targetId, action: 'MFA_RESET', result: 'SUCCESS' } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
