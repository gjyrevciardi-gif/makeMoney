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
      if (hasAnyCapability(request.actor.role, required)) return true;
      await this.recordDenial(request);
      throw new ForbiddenException('FORBIDDEN');
    }

    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!allowed?.length) return true;
    if (request.actor.role === Role.SUPER_ADMIN) return true;
    if (allowed.includes(request.actor.role)) return true;
    await this.recordDenial(request);
    throw new ForbiddenException('FORBIDDEN');
  }

  private recordDenial(request: AuthenticatedRequest) {
    return this.prisma.auditLog.create({
      data: {
        actorId: request.actor.id,
        targetType: 'ROUTE',
        targetId: request.url,
        action: 'PERMISSION_DENIED',
        result: 'DENIED',
        metadata: { method: request.method },
      },
    });
  }
}
