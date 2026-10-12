import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { resolveCorsOrigins, resolveEnvironment } from '../common/environment';

/** The refresh cookie is scoped to `/auth`; only these requests ride on it. */
export const REFRESH_COOKIE = 'refresh_token';

export type AuthOriginDecision =
  | { allowed: true }
  | { allowed: false; code: 'CSRF_ORIGIN_REJECTED' | 'CSRF_ORIGIN_REQUIRED'; message: string };

/**
 * Decides whether a state-changing request to `/auth` may proceed.
 *
 * A present `Origin` must match one of the configured CORS origins exactly:
 * `null`, a same-site sibling subdomain or any other value is refused, which is
 * the check SameSite=Lax/Strict cannot make on its own.
 *
 * Production additionally refuses a request that carries the refresh cookie but
 * no `Origin` at all, because that is the shape a cross-site form post has. A
 * client with no cookie (a native app, a server-to-server call, a script) may
 * omit the header outside that cookie-bearing case.
 */
export function evaluateAuthOrigin(input: {
  origin: string | undefined;
  allowlist: readonly string[];
  carriesRefreshCookie: boolean;
  requireOriginForCookie: boolean;
}): AuthOriginDecision {
  const { origin, allowlist, carriesRefreshCookie, requireOriginForCookie } = input;
  if (origin !== undefined) {
    if (origin !== 'null' && allowlist.includes(origin)) return { allowed: true };
    return {
      allowed: false,
      code: 'CSRF_ORIGIN_REJECTED',
      message: 'The request origin is not allowed.',
    };
  }
  if (carriesRefreshCookie && requireOriginForCookie) {
    return {
      allowed: false,
      code: 'CSRF_ORIGIN_REQUIRED',
      message: 'A trusted origin is required for this request.',
    };
  }
  return { allowed: true };
}

/**
 * Narrow CSRF guard for the auth mutations (register, login, second factor,
 * refresh, logout). It is attached to `AuthController` only; the CORS layer and
 * every other route are left as they are.
 */
@Injectable()
export class AuthOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const rawOrigin = request.headers.origin as string | string[] | undefined;
    const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    const cookie = request.cookies?.[REFRESH_COOKIE];
    const decision = evaluateAuthOrigin({
      origin,
      allowlist: resolveCorsOrigins(),
      carriesRefreshCookie: typeof cookie === 'string' && cookie.length > 0,
      requireOriginForCookie: resolveEnvironment() === 'production',
    });
    if (!decision.allowed) throw new ForbiddenException({ code: decision.code, message: decision.message });
    return true;
  }
}
