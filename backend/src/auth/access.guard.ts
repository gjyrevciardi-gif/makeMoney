import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, disabled: true },
      });
      if (!user) throw new Error('missing user');
      if (user.disabled) {
        // A disabled account's live token stops working immediately; the status
        // is read from the database, never from the token.
        throw new ForbiddenException('ACCOUNT_DISABLED');
      }
      request.actor = { id: user.id, role: user.role };
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }
}
