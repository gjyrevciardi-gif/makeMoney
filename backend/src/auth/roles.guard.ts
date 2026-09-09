import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuthenticatedRequest } from './access.guard';
import { ROLES_KEY } from './roles.decorator';
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!allowed?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (allowed.includes(request.actor.role)) return true;
    await this.prisma.auditLog.create({ data: { actorId: request.actor.id, targetType: 'ROUTE', targetId: request.url, action: 'PERMISSION_DENIED', result: 'DENIED', metadata: { method: request.method } } });
    throw new ForbiddenException('FORBIDDEN');
  }
}
