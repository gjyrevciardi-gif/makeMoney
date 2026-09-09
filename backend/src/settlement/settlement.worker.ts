import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../common/redis.service';
import { OperationsHealthService } from '../operations/operations-health.service';
import { SettlementService } from './settlement.service';

const WORKER_LOCK_KEY = 'sports:settlement:worker-lock';
const RELEASE_LOCK = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;
const RENEW_LOCK = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
  end
  return 0
`;

export type SettlementWorkerCycle = {
  status: 'SUCCESS' | 'PARTIAL_FAILURE' | 'FAILED' | 'SKIPPED_LOCKED';
  eventsChecked: number;
  failures: number;
  durationMs: number;
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

@Injectable()
export class SettlementWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private localRunning = false;
  private readonly pollSeconds = boundedInteger(
    process.env.SPORTS_SETTLEMENT_POLL_SECONDS,
    300,
    30,
    3_600,
  );
  private readonly lockTtlMs = boundedInteger(
    process.env.SPORTS_WORKER_LOCK_TTL_SECONDS,
    60,
    5,
    3_600,
  ) * 1_000;

  constructor(
    private readonly settlement: SettlementService,
    private readonly redis: RedisService,
    private readonly health: OperationsHealthService,
  ) {}

  onModuleInit() {
    if (process.env.SPORTS_SETTLEMENT_ENABLED !== 'true') return;
    this.timer = setInterval(() => {
      void this.runScheduledCycle();
    }, this.pollSeconds * 1_000);
    this.timer.unref();
  }

  async runScheduledCycle(): Promise<SettlementWorkerCycle> {
    const started = Date.now();
    if (this.localRunning) {
      this.logger.log({ event: 'SETTLEMENT_WORKER_SKIPPED_LOCKED', scope: 'process' });
      return { status: 'SKIPPED_LOCKED', eventsChecked: 0, failures: 0, durationMs: 0 };
    }
    this.localRunning = true;
    const owner = randomUUID();
    let ownsLock = false;
    let renewal: ReturnType<typeof setInterval> | undefined;
    try {
      await this.redis.ensureConnected();
      const acquired = await this.redis.client.set(
        WORKER_LOCK_KEY,
        owner,
        'PX',
        this.lockTtlMs,
        'NX',
      );
      if (acquired !== 'OK') {
        this.logger.log({ event: 'SETTLEMENT_WORKER_SKIPPED_LOCKED', scope: 'distributed' });
        return {
          status: 'SKIPPED_LOCKED',
          eventsChecked: 0,
          failures: 0,
          durationMs: Date.now() - started,
        };
      }
      ownsLock = true;
      renewal = setInterval(() => {
        void this.redis.client.eval(
          RENEW_LOCK,
          1,
          WORKER_LOCK_KEY,
          owner,
          String(this.lockTtlMs),
        ).catch(() => {
          this.logger.warn({ event: 'SETTLEMENT_WORKER_LOCK_RENEWAL_FAILED' });
        });
      }, Math.max(1_000, Math.floor(this.lockTtlMs / 3)));
      renewal.unref();

      this.logger.log({ event: 'SETTLEMENT_WORKER_STARTED' });
      await this.health.workerStarted();
      const result = await this.settlement.runOnce();
      const status = result.failures > 0 ? 'PARTIAL_FAILURE' : 'SUCCESS';
      const durationMs = Date.now() - started;
      await this.health.workerCompleted(status, durationMs, result.eventsChecked, result.failures);
      this.logger.log({
        event: 'SETTLEMENT_WORKER_COMPLETED',
        status,
        durationMs,
        eventsChecked: result.eventsChecked,
        failures: result.failures,
      });
      return { status, durationMs, ...result };
    } catch {
      const durationMs = Date.now() - started;
      await this.health.workerCompleted('FAILED', durationMs, 0, 1);
      this.logger.error({ event: 'SETTLEMENT_WORKER_COMPLETED', status: 'FAILED', durationMs });
      return { status: 'FAILED', eventsChecked: 0, failures: 1, durationMs };
    } finally {
      if (renewal) clearInterval(renewal);
      if (ownsLock) {
        try {
          await this.redis.client.eval(RELEASE_LOCK, 1, WORKER_LOCK_KEY, owner);
        } catch {
          this.logger.warn({ event: 'SETTLEMENT_WORKER_LOCK_RELEASE_FAILED' });
        }
      }
      this.localRunning = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
