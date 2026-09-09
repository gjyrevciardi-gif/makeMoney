import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../common/redis.service';

@Controller('health')
export class ProductionHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res() response: Response) {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const ready = checks.every(Boolean);
    return response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: ready ? 'ok' : 'unavailable',
      checks: { database: checks[0], redis: checks[1] },
    });
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
