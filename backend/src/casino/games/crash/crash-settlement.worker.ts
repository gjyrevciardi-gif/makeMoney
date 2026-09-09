import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../../common/redis.service';
import { CrashService } from './crash.service';

const WORKER_LOCK_KEY = 'casino:crash:settlement-lock';
const RELEASE_LOCK = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

/**
 * Terminates abandoned Crash rounds.
 *
 * A round must reach its outcome on server time whether or not the browser is
 * still open, so this sweeps for OPEN rounds whose curve has already passed the
 * hidden crash point (or a due auto-cashout) and settles them. It reuses the
 * same Redis lease pattern as the sportsbook settlement worker so two instances
 * cannot sweep at once, and the settlement itself is idempotent regardless.
 *
 * Disabled in tests, where the sweep is driven explicitly through `runOnce()`
 * against an injected clock instead of a timer.
 */
@Injectable()
export class CrashSettlementWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrashSettlementWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly intervalMs = boundedInteger(
    process.env.CASINO_CRASH_SWEEP_MS,
    2_000,
    250,
    60_000,
  );
  private readonly lockTtlMs = boundedInteger(
    process.env.CASINO_CRASH_LOCK_TTL_MS,
    10_000,
    1_000,
    120_000,
  );

  constructor(
    private readonly crash: CrashService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (process.env.CASINO_CRASH_WORKER_ENABLED === 'false') return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref();
  }

  async runOnce() {
    if (this.running) return { status: 'SKIPPED_LOCAL' as const, scanned: 0, settled: 0 };
    this.running = true;
    const owner = randomUUID();
    let ownsLock = false;
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
        return { status: 'SKIPPED_LOCKED' as const, scanned: 0, settled: 0 };
      }
      ownsLock = true;
      const result = await this.crash.settleDue();
      if (result.settled > 0) {
        this.logger.log({ event: 'CASINO_CRASH_SWEEP', ...result });
      }
      return { status: 'SUCCESS' as const, ...result };
    } catch {
      this.logger.warn({ event: 'CASINO_CRASH_SWEEP_FAILED' });
      return { status: 'FAILED' as const, scanned: 0, settled: 0 };
    } finally {
      if (ownsLock) {
        try {
          await this.redis.client.eval(RELEASE_LOCK, 1, WORKER_LOCK_KEY, owner);
        } catch {
          this.logger.warn({ event: 'CASINO_CRASH_SWEEP_LOCK_RELEASE_FAILED' });
        }
      }
      this.running = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
