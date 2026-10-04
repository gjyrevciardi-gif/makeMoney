import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';

/**
 * Bounded execution for the control plane's CPU-heavy work.
 *
 * Profile generation and activation-grade validation are real computations -
 * board enumeration, a Monte Carlo run and a session cohort. They must not run
 * unbounded on the HTTP event loop, so every request goes through this runner:
 *
 *  - one job at a time (concurrency 1) with a bounded queue,
 *  - a hard per-job timeout,
 *  - the heavy part executed in a worker thread when the compiled adapter is
 *    available, so a long job never blocks request handling,
 *  - every clamp and the chosen execution path recorded on the job, so an
 *    operator can see exactly what ran.
 */

export const MAX_QUEUE_DEPTH = 4;
export const JOB_TIMEOUT_MS = Number(process.env.MATH_CONTROL_JOB_TIMEOUT_MS ?? 180_000);

export type MathJobKind = 'GENERATE' | 'VALIDATE';

export type MathJob<T = unknown> = {
  id: string;
  kind: MathJobKind;
  gameId: string;
  actorId: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  execution: 'worker-thread' | 'in-process-bounded' | 'not-started';
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: T | null;
  error: { code: string; message: string } | null;
};

export type WorkerJobPayload = {
  kind: MathJobKind;
  modulePath: string;
  exportName: string;
  policy?: unknown;
  artifact?: unknown;
  options?: unknown;
};

type QueuedJob = MathJob & {
  work: (execution: 'worker-thread' | 'in-process-bounded') => Promise<unknown>;
  worker?: WorkerJobPayload;
};

@Injectable()
export class MathControlJobs {
  private readonly logger = new Logger(MathControlJobs.name);
  private readonly jobs = new Map<string, QueuedJob>();
  private readonly order: string[] = [];
  private running = false;

  submit<T>(
    input: { kind: MathJobKind; gameId: string; actorId: string; worker?: WorkerJobPayload },
    work: (execution: 'worker-thread' | 'in-process-bounded') => Promise<T>,
  ): MathJob<T> {
    const queued = this.order.filter((id) => this.jobs.get(id)?.status === 'QUEUED').length;
    if (queued >= MAX_QUEUE_DEPTH) {
      throw new ServiceUnavailableException({
        code: 'MATH_JOB_QUEUE_FULL',
        message: `The mathematics worker is busy (${queued} queued). Retry shortly.`,
      });
    }
    const job: QueuedJob = {
      id: randomUUID(),
      kind: input.kind,
      gameId: input.gameId,
      actorId: input.actorId,
      status: 'QUEUED',
      execution: 'not-started',
      requestedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      work,
      worker: input.worker,
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    void this.tick();
    return job as MathJob<T>;
  }

  status(jobId: string): MathJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException({ code: 'MATH_JOB_NOT_FOUND', message: 'Unknown mathematics job.' });
    return job;
  }

  list(gameId?: string): MathJob[] {
    return this.order
      .map((id) => this.jobs.get(id)!)
      .filter((job) => (gameId ? job.gameId === gameId : true))
      .slice(-25);
  }

  /** Wait for a job to reach a terminal state; used by tests and the CLI path. */
  async waitFor<T>(jobId: string, timeoutMs = JOB_TIMEOUT_MS + 5_000): Promise<MathJob<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = this.status(jobId) as MathJob<T>;
      if (job.status === 'DONE' || job.status === 'FAILED') return job;
      if (Date.now() > deadline) {
        throw new ServiceUnavailableException({
          code: 'MATH_JOB_TIMEOUT',
          message: 'The mathematics job did not finish inside the wait window.',
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * Submit and await one bounded job.
   *
   * The CPU work still happens on the bounded runner (worker thread when the
   * compiled adapter is available, otherwise the serialized in-process queue
   * with a timeout), so a long job never runs unconstrained inside a request.
   */
  async run<T>(
    input: { kind: MathJobKind; gameId: string; actorId: string; worker?: WorkerJobPayload },
    work: (execution: 'worker-thread' | 'in-process-bounded') => Promise<T>,
  ): Promise<{ job: MathJob<T>; result: T }> {
    const submitted = this.submit<T>(input, work);
    const job = await this.waitFor<T>(submitted.id);
    if (job.status !== 'DONE' || job.result === null) {
      const error = job.error ?? { code: 'MATH_JOB_FAILED', message: 'The mathematics job failed.' };
      const failure = new Error(error.message) as Error & { code?: string };
      failure.code = error.code;
      throw failure;
    }
    return { job, result: job.result };
  }

  private async tick() {
    if (this.running) return;
    const next = this.order
      .map((id) => this.jobs.get(id)!)
      .find((job) => job.status === 'QUEUED');
    if (!next) return;
    this.running = true;
    next.status = 'RUNNING';
    next.startedAt = new Date().toISOString();
    try {
      const workerReady = next.worker ? this.workerPath() : null;
      const execution: QueuedJob['execution'] = workerReady ? 'worker-thread' : 'in-process-bounded';
      next.execution = execution;
      const work = workerReady && next.worker
        ? this.runInWorker(next.worker, workerReady, JOB_TIMEOUT_MS)
        : this.withTimeout(next.work('in-process-bounded'), JOB_TIMEOUT_MS);
      next.result = await work;
      next.status = 'DONE';
    } catch (error) {
      next.status = 'FAILED';
      next.error = {
        code: (error as { code?: string }).code ?? 'MATH_JOB_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
      this.logger.warn(`math job ${next.id} failed: ${next.error.message}`);
    } finally {
      next.finishedAt = new Date().toISOString();
      this.running = false;
      // Keep memory bounded: only the most recent 50 jobs are retained.
      while (this.order.length > 50) {
        const dropped = this.order.shift()!;
        this.jobs.delete(dropped);
      }
      void this.tick();
    }
  }

  private withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MATH_JOB_TIMEOUT')), timeoutMs);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  /** The compiled worker entry, or `null` in a source-only environment. */
  private workerPath(): string | null {
    if (process.env.MATH_CONTROL_INPROCESS === '1') return null;
    if (process.env.JEST_WORKER_ID) return null;
    if (!__filename.endsWith('.js')) return null;
    const candidate = join(dirname(__filename), 'math-control.worker.js');
    return candidate;
  }

  private runInWorker(payload: WorkerJobPayload, workerPath: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { workerData: payload });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('MATH_JOB_TIMEOUT'));
      }, timeoutMs);
      worker.once('message', (message: { ok: boolean; result?: unknown; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (message.ok) resolve(message.result);
        else reject(new Error(message.error ?? 'MATH_WORKER_FAILED'));
      });
      worker.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }
}
