import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../common/redis.service';

const PROVIDER_KEY = 'ops:sports:provider:the-odds-api';
const WORKER_KEY = 'ops:sports:settlement-worker';

@Injectable()
export class OperationsHealthService {
  private readonly logger = new Logger(OperationsHealthService.name);
  private lastCacheErrorAt?: string;

  constructor(private readonly redis: RedisService) {}

  private async connected<T>(operation: () => Promise<T>): Promise<T | undefined> {
    try {
      await this.redis.ensureConnected();
      const result = await operation();
      this.lastCacheErrorAt = undefined;
      return result;
    } catch {
      this.lastCacheErrorAt = new Date().toISOString();
      this.logger.warn({ event: 'SPORTS_OPERATIONS_REDIS_UNAVAILABLE' });
      return undefined;
    }
  }

  private async write(key: string, values: Record<string, string | number | undefined>) {
    const entries = Object.entries(values)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .flatMap(([name, value]) => [name, String(value)]);
    if (entries.length) await this.connected(() => this.redis.client.hset(key, ...entries));
  }

  async providerSuccess(quota: { remaining?: number; used?: number } = {}) {
    const now = new Date().toISOString();
    await this.write(PROVIDER_KEY, {
      lastRequestAt: now,
      lastSuccessAt: now,
      lastErrorCode: '',
      consecutiveFailures: 0,
      remainingQuota: quota.remaining,
      usedQuota: quota.used,
    });
  }

  async providerFailure(code: string) {
    const now = new Date().toISOString();
    await this.connected(async () => {
      const failures = await this.redis.client.hincrby(PROVIDER_KEY, 'consecutiveFailures', 1);
      await this.redis.client.hset(
        PROVIDER_KEY,
        'lastRequestAt', now,
        'lastFailureAt', now,
        'lastErrorCode', code,
        'consecutiveFailures', String(failures),
      );
    });
  }

  async workerStarted() {
    await this.write(WORKER_KEY, { lastStartedAt: new Date().toISOString() });
  }

  async workerCompleted(status: string, durationMs: number, eventsChecked: number, failures: number) {
    await this.connected(async () => {
      const consecutive = status === 'SUCCESS'
        ? 0
        : await this.redis.client.hincrby(WORKER_KEY, 'consecutiveRunFailures', 1);
      await this.redis.client.hset(
        WORKER_KEY,
        'lastCompletedAt', new Date().toISOString(),
        'lastStatus', status,
        'lastDurationMs', String(durationMs),
        'eventsChecked', String(eventsChecked),
        'failures', String(failures),
        'consecutiveRunFailures', String(consecutive),
      );
    });
  }

  async status() {
    const snapshot = await this.connected(async () => {
      const [provider, worker, pong] = await Promise.all([
        this.redis.client.hgetall(PROVIDER_KEY),
        this.redis.client.hgetall(WORKER_KEY),
        this.redis.client.ping(),
      ]);
      return { provider, worker, cacheHealthy: pong === 'PONG' };
    });
    return snapshot ?? {
      provider: {},
      worker: {},
      cacheHealthy: false,
      lastCacheErrorAt: this.lastCacheErrorAt,
    };
  }
}
