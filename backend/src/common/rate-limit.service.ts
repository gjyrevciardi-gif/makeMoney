import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';
export const RATE_LIMITS = {
  loginFailures: { limit: 5, window: 60 },
  register: { limit: 3, window: 3600 },
  refresh: { limit: 20, window: 60 },
  bet: { limit: 30, window: 60 },
  admin: { limit: 20, window: 60 },
  adminReconcile: { limit: 30, window: 60 },
  casino: { limit: 120, window: 60 },
  // Integrated-game launch issuance and capability exchange are cheap for the
  // platform but expensive for an attacker guessing opaque tokens.
  gameLaunch: { limit: 20, window: 60 },
  gameExchange: { limit: 30, window: 60 },
  gameRead: { limit: 240, window: 60 },
} as const;

/**
 * Increment a window and set its expiry in one round trip. `INCR` then `EXPIRE`
 * as two commands is not atomic: a crash or dropped connection between them
 * leaves a counter with no TTL, which never rolls over and locks the subject out
 * for good. Limits and windows are unchanged.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}
  async consume(scope: string, subject: string, policy: { limit: number; window: number }) {
    await this.redis.ensureConnected();
    const key = `rate:${scope}:${subject}`;
    const count = Number(await this.redis.client.eval(CONSUME_SCRIPT, 1, key, policy.window));
    if (count > policy.limit) throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
  }
  async assertAllowed(scope: string, subject: string, policy: { limit: number; window: number }) {
    await this.redis.ensureConnected();
    const count = Number((await this.redis.client.get(`rate:${scope}:${subject}`)) ?? 0);
    if (count >= policy.limit) throw new HttpException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
  }
  async reset(scope: string, subject: string) { await this.redis.ensureConnected(); await this.redis.client.del(`rate:${scope}:${subject}`); }
}
