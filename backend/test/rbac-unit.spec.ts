import { ConflictException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import {
  assertNotLastActiveSuperAdmin,
  withSerializationConflict,
} from '../src/auth/authorization.service';
import { bootstrapSuperAdmin, type BootstrapClient } from '../src/auth/super-admin-bootstrap';

/**
 * Pure, database-free coverage of the RBAC guards' decision logic.
 *
 * The shared last-super-admin guard (used by BOTH role demotion and account
 * disable), the serialization-conflict mapping, and the bootstrap preconditions
 * are all exercised with mocks, so no real account is touched.
 */
describe('RBAC guard logic (unit)', () => {
  describe('withSerializationConflict', () => {
    it('maps a Prisma P2034 serialization conflict to HTTP 409', async () => {
      const p2034 = new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: 'test',
      });
      await expect(withSerializationConflict(async () => { throw p2034; })).rejects.toMatchObject({
        status: 409,
        response: { code: 'SERIALIZATION_CONFLICT' },
      });
    });

    it('rethrows a non-P2034 error unchanged', async () => {
      const other = new Error('boom');
      await expect(withSerializationConflict(async () => { throw other; })).rejects.toBe(other);
    });

    it('returns the work result on success', async () => {
      await expect(withSerializationConflict(async () => 'ok')).resolves.toBe('ok');
    });
  });

  describe('assertNotLastActiveSuperAdmin (shared by demotion and disable)', () => {
    it('refuses when no other active SUPER_ADMIN remains', async () => {
      const tx = { user: { count: async () => 0 } } as unknown as Prisma.TransactionClient;
      await expect(assertNotLastActiveSuperAdmin(tx, 'target')).rejects.toMatchObject({
        response: { code: 'LAST_SUPER_ADMIN_REQUIRED' },
      });
    });

    it('allows the removal when another active SUPER_ADMIN remains', async () => {
      const tx = { user: { count: async () => 1 } } as unknown as Prisma.TransactionClient;
      await expect(assertNotLastActiveSuperAdmin(tx, 'target')).resolves.toBeUndefined();
    });
  });

  describe('bootstrapSuperAdmin preconditions', () => {
    const mockClient = (user: Record<string, unknown> | null, superCount: number) => {
      const update = jest.fn(async () => ({ id: 'u1' }));
      const create = jest.fn(async () => ({ id: 'audit' }));
      const client = {
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            $executeRaw: async () => undefined,
            user: { findUnique: async () => user, count: async () => superCount, update },
            auditLog: { create },
          }),
      } as unknown as BootstrapClient;
      return { client, update, create };
    };

    it('promotes an existing active ADMIN when no SUPER_ADMIN exists', async () => {
      const { client, update, create } = mockClient(
        { id: 'u1', email: 'a@example.test', role: Role.ADMIN, disabled: false },
        0,
      );
      const outcome = await bootstrapSuperAdmin(client, 'a@example.test');
      expect(outcome).toEqual({ status: 'PROMOTED', email: 'a@example.test', from: Role.ADMIN });
      expect(update).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('refuses a promotion when an active SUPER_ADMIN already exists', async () => {
      const { client, update } = mockClient(
        { id: 'u1', email: 'a@example.test', role: Role.ADMIN, disabled: false },
        1,
      );
      const outcome = await bootstrapSuperAdmin(client, 'a@example.test');
      expect(outcome).toMatchObject({ status: 'REFUSED', code: 'SUPER_ADMIN_ALREADY_EXISTS' });
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses a target that is not an active ADMIN', async () => {
      const { client, update } = mockClient(
        { id: 'u1', email: 'a@example.test', role: Role.USER, disabled: false },
        0,
      );
      const outcome = await bootstrapSuperAdmin(client, 'a@example.test');
      expect(outcome).toMatchObject({ status: 'REFUSED', code: 'ACTIVE_ADMIN_REQUIRED' });
      expect(update).not.toHaveBeenCalled();
    });

    it('is a safe no-op when the account is already SUPER_ADMIN', async () => {
      const { client, update } = mockClient(
        { id: 'u1', email: 'a@example.test', role: Role.SUPER_ADMIN, disabled: false },
        1,
      );
      const outcome = await bootstrapSuperAdmin(client, 'a@example.test');
      expect(outcome).toEqual({ status: 'NOOP', email: 'a@example.test', reason: 'ALREADY_SUPER_ADMIN' });
      expect(update).not.toHaveBeenCalled();
    });

    it('refuses when no such user exists', async () => {
      const { client } = mockClient(null, 0);
      const outcome = await bootstrapSuperAdmin(client, 'missing@example.test');
      expect(outcome).toMatchObject({ status: 'REFUSED', code: 'USER_NOT_FOUND' });
    });
  });
});
