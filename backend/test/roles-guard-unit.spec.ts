import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { CAPABILITIES_KEY } from '../src/auth/capabilities.decorator';
import { ROLES_KEY } from '../src/auth/roles.decorator';
import { RolesGuard } from '../src/auth/roles.guard';
import type { AuthenticatedRequest } from '../src/auth/access.guard';
import { PrismaService } from '../src/prisma.service';

type Metadata = { capabilities?: string[]; roles?: Role[] };

/**
 * DB-free coverage of the two authorization branches in `RolesGuard`.
 *
 * The legacy `@Roles` path has no production routes today, but it must not be a
 * way around the second-factor gate that the capability path already enforces.
 */
function buildGuard(metadata: Metadata, actor: { id: string; role: Role }, enrolled: boolean) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === CAPABILITIES_KEY ? metadata.capabilities : key === ROLES_KEY ? metadata.roles : undefined,
  } as unknown as Reflector;
  const findUnique = jest.fn(async () => (enrolled ? { enabledAt: new Date() } : null));
  const auditCreate = jest.fn(async (_payload: unknown) => ({ id: 'audit' }));
  const prisma = { userTotp: { findUnique }, auditLog: { create: auditCreate } } as unknown as PrismaService;
  const request = {
    actor,
    method: 'GET',
    baseUrl: '',
    path: '/admin/users',
    url: '/admin/users?token=must-not-be-audited',
    route: { path: '/admin/users' },
  } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(reflector, prisma), context, findUnique, auditCreate };
}

const admin: { id: string; role: Role } = { id: 'admin-1', role: Role.ADMIN };

describe('RolesGuard second-factor enforcement', () => {
  const original = process.env.ADMIN_MFA_REQUIRED;
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_MFA_REQUIRED;
    else process.env.ADMIN_MFA_REQUIRED = original;
  });

  it('keeps the capability branch working for an enrolled administrator', async () => {
    process.env.ADMIN_MFA_REQUIRED = 'true';
    const { guard, context } = buildGuard({ capabilities: ['USER_MANAGE'] }, admin, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('refuses a capability holder who has not enrolled once MFA is required', async () => {
    process.env.ADMIN_MFA_REQUIRED = 'true';
    const { guard, context } = buildGuard({ capabilities: ['USER_MANAGE'] }, admin, false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'MFA_ENROLLMENT_REQUIRED' },
    });
  });

  it('applies the same gate to a legacy @Roles branch that names the administrator', async () => {
    process.env.ADMIN_MFA_REQUIRED = 'true';
    const { guard, context, findUnique } = buildGuard({ roles: [Role.ADMIN] }, admin, false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'MFA_ENROLLMENT_REQUIRED' },
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('applies the gate to a SUPER_ADMIN clearing a legacy role list', async () => {
    process.env.ADMIN_MFA_REQUIRED = 'true';
    const { guard, context } = buildGuard({ roles: [Role.ADMIN] }, { id: 'root', role: Role.SUPER_ADMIN }, false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { code: 'MFA_ENROLLMENT_REQUIRED' },
    });
  });

  it('allows an enrolled administrator through the legacy branch', async () => {
    process.env.ADMIN_MFA_REQUIRED = 'true';
    const { guard, context } = buildGuard({ roles: [Role.ADMIN] }, admin, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('leaves the legacy branch untouched when MFA is not required', async () => {
    delete process.env.ADMIN_MFA_REQUIRED;
    const { guard, context, findUnique } = buildGuard({ roles: [Role.ADMIN] }, admin, false);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('denies a role that is neither listed nor a SUPER_ADMIN and audits it', async () => {
    delete process.env.ADMIN_MFA_REQUIRED;
    const { guard, context, auditCreate } = buildGuard({ roles: [Role.ADMIN] }, { id: 'player', role: Role.USER }, false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    expect(auditCreate).toHaveBeenCalledTimes(1);
  });

  it('records the route, never the query string, on a denial', async () => {
    delete process.env.ADMIN_MFA_REQUIRED;
    const { guard, context, auditCreate } = buildGuard({ capabilities: ['USER_MANAGE'] }, { id: 'player', role: Role.USER }, false);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    const payload = auditCreate.mock.calls[0][0] as unknown as { data: { targetId: string; metadata: unknown } };
    expect(payload.data.targetId).toBe('/admin/users');
    expect(JSON.stringify(payload.data)).not.toContain('must-not-be-audited');
  });
});
