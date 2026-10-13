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
/**
 * `authVersion` is the exact version the presented token was verified against.
 * Callers that mint another credential (game launch capabilities) must forward
 * it, so the mint can be re-checked under the account lock instead of trusting
 * a check that already happened.
 */
export type AuthenticatedRequest = Request & { actor: { id: string; role: Role; authVersion: number } };
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
      const payload = await this.jwt.verifyAsync<{ sub: string; typ?: string; av?: unknown }>(token);
      // A second-factor challenge proves only the password step; it is never an access token.
      if (payload.typ) throw new Error('not an access token');
      // The token carries the session version it was issued under. A missing,
      // malformed or stale claim is refused before anything else: there is no
      // timestamp to compare, just an exact integer match against the account.
      const version = payload.av;
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw new Error('invalid session version claim');
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, disabled: true, authVersion: true },
      });
      if (!user) throw new Error('missing user');
      if (user.disabled) {
        // A disabled account's live token stops working immediately; the status
        // is read from the database, never from the token.
        throw new ForbiddenException('ACCOUNT_DISABLED');
      }
      if (version !== user.authVersion) throw new Error('stale session version');
      request.actor = { id: user.id, role: user.role, authVersion: user.authVersion };
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('INVALID_ACCESS_TOKEN');
    }
  }
}
