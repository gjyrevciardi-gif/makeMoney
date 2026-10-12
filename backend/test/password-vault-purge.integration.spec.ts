import * as argon2 from 'argon2';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma.service';
import { uniqueTestEmail } from './test-identity';

/**
 * Milestone A1 migration: `20261012130000_retire_password_vault` must purge only
 * the historical reversible password copies and leave every other security-relevant
 * row byte-identical. The test executes the committed migration file itself, not a
 * hand-copied statement, so a later edit that widens the purge fails here.
 *
 * Requires an isolated *_test PostgreSQL database.
 */
describe('retire password vault migration (PostgreSQL)', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaService();
  const migrationPath = join(__dirname, '..', 'prisma', 'migrations', '20261012130000_retire_password_vault', 'migration.sql');
  const migrationSql = readFileSync(migrationPath, 'utf8');
  /** Strip the `--` commentary so the body can run through the extended protocol. */
  const statements = migrationSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim();

  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "SecurityEvent", "UserRecoveryCode", "UserTotp", "LedgerEntry", "AuditLog", ' +
      '"RefreshToken", "UserPasswordVault", "Wallet", "User" CASCADE',
    );
  });

  /** A user with the security columns the purge must not touch, plus a TOTP secret. */
  async function seedUser(label: string, secret: string) {
    const passwordHash = await argon2.hash(secret, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        username: label,
        email: uniqueTestEmail(label),
        passwordHash,
        role: 'ADMIN',
        authVersion: 7,
        wallet: { create: { balance: 123n } },
      },
    });
    await prisma.userTotp.create({
      data: { userId: user.id, ciphertext: 'totp-cipher', iv: 'totp-iv', authTag: 'totp-tag', keyId: 'v1', lastStep: 42 },
    });
    await prisma.userPasswordVault.create({
      data: { userId: user.id, ciphertext: 'pw-cipher', iv: 'pw-iv', authTag: 'pw-tag', keyId: 'v1', updatedById: user.id },
    });
    return user;
  }

  it('is a data-only change that deletes from UserPasswordVault and nothing else', () => {
    expect(statements).toMatch(/DELETE\s+FROM\s+"UserPasswordVault"\s*;?/i);
    expect(statements.replace(/DELETE\s+FROM\s+"UserPasswordVault"\s*;?/gi, '').trim()).toBe('');
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b(?!\s*"UserPasswordVault")/i);
    expect(statements).not.toMatch(/\bALTER\s+TABLE\b/i);
  });

  it('purges historical vault rows while the user, hash, authVersion and MFA rows stay intact', async () => {
    const user = await seedUser('purge.target', 'purge-secret-1');
    const before = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { wallet: true } }),
      totp: await prisma.userTotp.findUniqueOrThrow({ where: { userId: user.id } }),
    };
    expect(await prisma.userPasswordVault.count({ where: { userId: user.id } })).toBe(1);

    await prisma.$executeRawUnsafe(statements);

    expect(await prisma.userPasswordVault.count()).toBe(0);
    const after = {
      user: await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { wallet: true } }),
      totp: await prisma.userTotp.findUniqueOrThrow({ where: { userId: user.id } }),
    };
    expect(after.user).toEqual(before.user);
    expect(after.totp).toEqual(before.totp);
    expect(after.user.id).toBe(user.id);
    expect(after.user.passwordHash).toBe(before.user.passwordHash);
    expect(after.user.authVersion).toBe(7);
    expect(after.user.disabled).toBe(false);
    expect(after.user.wallet?.balance).toBe(123n);
    // The stored hash still answers the original password; nothing re-hashed it.
    expect(await argon2.verify(after.user.passwordHash, 'purge-secret-1')).toBe(true);
    // The TOTP secret is still the same ciphertext under the same key id.
    expect(after.totp.ciphertext).toBe('totp-cipher');
    expect(after.totp.keyId).toBe('v1');
    expect(after.totp.lastStep).toBe(42);
  });

  it('purges every historical row across users and is safe to run twice', async () => {
    const first = await seedUser('purge.first', 'purge-secret-2');
    const second = await seedUser('purge.second', 'purge-secret-3');
    await prisma.userPasswordVault.deleteMany({ where: { userId: second.id } });
    expect(await prisma.userPasswordVault.count()).toBe(1);

    await prisma.$executeRawUnsafe(statements);
    await prisma.$executeRawUnsafe(statements);

    expect(await prisma.userPasswordVault.count()).toBe(0);
    // Both accounts survive with their own hash, version and MFA secret.
    for (const [user, secret] of [[first, 'purge-secret-2'], [second, 'purge-secret-3']] as const) {
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.passwordHash).toBe(user.passwordHash);
      expect(row.authVersion).toBe(user.authVersion);
      expect(await argon2.verify(row.passwordHash, secret)).toBe(true);
      expect(await prisma.userTotp.count({ where: { userId: user.id } })).toBe(1);
    }
  });
});
