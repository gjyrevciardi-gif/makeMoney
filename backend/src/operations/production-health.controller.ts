import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../common/redis.service';

const CHECK_TIMEOUT_MS = 3_000;

/**
 * Orchestrator-facing health probes.
 *
 * Liveness answers "is this process still working" and must never depend on
 * anything external, or a database blip would make the orchestrator kill healthy
 * containers in a loop.
 *
 * Readiness answers "can this instance serve traffic" and therefore checks only
 * what every request needs: PostgreSQL and Redis. Third-party feeds — the odds
 * provider above all — are deliberately excluded. Their outage degrades the
 * sportsbook pages alone, and letting it mark the instance unready would pull
 * the casino, wallet, and auth out of the load balancer along with it.
 */
@Controller('health')
export class ProductionHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live(@Res({ passthrough: true }) response: Response) {
    response.setHeader('cache-control', 'no-store');
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  // `passthrough` matters here: returning the Express response object instead
  // would hand it to the global serializing interceptor, which walks it and
  // overflows the stack. Only the status is set directly; the body is returned.
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const [database, cache] = await Promise.all([
      this.withTimeout(this.checkDatabase()),
      this.withTimeout(this.checkRedis()),
    ]);
    const ready = database && cache;
    response.setHeader('cache-control', 'no-store');
    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ready ? 'ok' : 'unavailable',
      checks: { database, redis: cache },
    };
  }

  /**
   * A hung dependency must not hang the probe: an unanswered check reads as a
   * failed one so the orchestrator gets a verdict inside its own timeout.
   */
  private async withTimeout(check: Promise<boolean>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        check,
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.ensureConnected();
      return (await this.redis.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
