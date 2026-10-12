import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthenticatedRequest } from './access.guard';
import { hasAnyCapability, type Capability } from './capabilities';
import { CAPABILITIES_KEY } from './capabilities.decorator';
import { ROLES_KEY } from './roles.decorator';

/**
 * Route authorization.
 *
 * Prefers the capability metadata (`@Capabilities`) when present, otherwise the
 * legacy role list (`@Roles`). The actor's role was re-read from the database by
 * `AccessGuard`, so a demoted or disabled account cannot act on a stale JWT.
 * SUPER_ADMIN holds every capability and therefore satisfies any legacy role
 * list, which lets older ADMIN-only routes keep working unchanged.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const required = this.reflector.getAllAndOverride<Capability[]>(CAPABILITIES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length) {
      if (hasAnyCapability(request.actor.role, required)) {
        await this.assertMfaEnrolled(request);
        return true;
      }
      await this.recordDenial(request);
      throw new ForbiddenException('FORBIDDEN');
    }

    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!allowed?.length) return true;
    // The legacy role list grants the same privileged access as a capability, so
    // it enforces the same second-factor gate: SUPER_ADMIN clears every list, and
    // both branches must still prove enrolment rather than skipping the check.
    if (request.actor.role === Role.SUPER_ADMIN || allowed.includes(request.actor.role)) {
      await this.assertMfaEnrolled(request);
      return true;
    }
    await this.recordDenial(request);
    throw new ForbiddenException('FORBIDDEN');
  }

  /**
   * With ADMIN_MFA_REQUIRED=true an administrator must have Google Authenticator on before any admin route
   * works. The enrolment endpoints carry no capability metadata, so they stay reachable.
   */
  private async assertMfaEnrolled(request: AuthenticatedRequest) {
    if (process.env.ADMIN_MFA_REQUIRED !== 'true' || request.actor.role === Role.USER) return;
    const enrolled = await this.prisma.userTotp.findUnique({ where: { userId: request.actor.id }, select: { enabledAt: true } });
    if (!enrolled?.enabledAt) {
      throw new ForbiddenException({ code: 'MFA_ENROLLMENT_REQUIRED', message: 'Turn on Google Authenticator to use admin tools.' });
    }
  }

  private recordDenial(request: AuthenticatedRequest) {
    return this.prisma.auditLog.create({
      data: {
        actorId: request.actor.id,
        targetType: 'ROUTE',
        targetId: this.routePath(request),
        action: 'PERMISSION_DENIED',
        result: 'DENIED',
        metadata: { method: request.method },
      },
    });
  }

  /**
   * The matched route template, or the request path. `request.url` is never
   * recorded: it carries the query string, which can hold parameters that must
   * not end up in the audit trail.
   */
  private routePath(request: AuthenticatedRequest) {
    const template = (request as { route?: { path?: string } }).route?.path;
    return template ?? `${request.baseUrl ?? ''}${request.path ?? ''}`;
  }
}
