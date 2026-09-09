import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
export type AuthenticatedRequest = Request & { actor: { id: string; role: Role } };
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const parts = authorization?.trim().split(/\s+/) ?? [];
    if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
      throw new UnauthorizedException('AUTHENTICATION_REQUIRED');
    }
    const token = parts[1];
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, role: true } });
      if (!user) throw new Error('missing user');
      request.actor = user;
      return true;
    } catch { throw new UnauthorizedException('INVALID_ACCESS_TOKEN'); }
  }
}
