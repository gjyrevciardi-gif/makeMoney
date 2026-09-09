import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6380', { lazyConnect: true, maxRetriesPerRequest: 2 });
  private readonly inFlight = new Map<string, Promise<unknown>>();
  async ensureConnected() { if (this.client.status === 'wait') await this.client.connect(); }
  async cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    await this.ensureConnected();
    const hit = await this.client.get(key);
    if (hit) { this.logger.debug({ event: 'SPORTS_CACHE_HIT', key }); return JSON.parse(hit) as T; }
    this.logger.debug({ event: 'SPORTS_CACHE_MISS', key });
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = loader().then(async value => { await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds); return value; }).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
  async onModuleDestroy() { if (this.client.status !== 'end') await this.client.quit(); }
}
