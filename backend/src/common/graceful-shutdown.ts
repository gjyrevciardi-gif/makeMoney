import type { INestApplication } from '@nestjs/common';
import { CrashSettlementWorker } from '../casino/games/crash/crash-settlement.worker';
import { SettlementWorker } from '../settlement/settlement.worker';

/**
 * A background worker that can be told to stop and then waited on.
 *
 * `drain()` must stop scheduling new cycles and resolve only once the cycle that
 * is already running has finished, so settlement work is never torn down
 * halfway through.
 */
export type DrainableWorker = { drain(): Promise<void> };

const DEFAULT_TIMEOUT_MS = 20_000;

function log(stream: NodeJS.WriteStream, fields: Record<string, unknown>): void {
  stream.write(`${JSON.stringify(fields)}\n`);
}

function resolveWorkers(app: INestApplication): DrainableWorker[] {
  return [SettlementWorker, CrashSettlementWorker].flatMap(token => {
    try {
      return [app.get<DrainableWorker>(token, { strict: false })];
    } catch {
      // A worker that is not registered in this build has nothing to drain.
      return [];
    }
  });
}

/**
 * Shuts the process down in the one order that is safe.
 *
 * On SIGTERM the orchestrator has already stopped routing new requests here, so
 * the sequence is: let in-flight settlement cycles finish, then close Nest —
 * which stops the HTTP server and runs the module hooks that disconnect Prisma
 * and quit Redis. Draining before `app.close()` matters because Nest gives no
 * ordering guarantee between provider destroy hooks, so a worker mid-cycle could
 * otherwise lose its database connection underneath it.
 *
 * Settlement writes are transactional and idempotent, so an aborted cycle is
 * already safe for the ledger; draining keeps it from happening at all, and the
 * hard timeout guarantees the process still exits if a cycle wedges.
 */
export function installGracefulShutdown(
  app: INestApplication,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): void {
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(process.stdout, { event: 'SHUTDOWN_STARTED', signal });

    const forceExit = setTimeout(() => {
      log(process.stderr, { event: 'SHUTDOWN_TIMED_OUT', signal, timeoutMs });
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    let exitCode = 0;
    try {
      await Promise.all(resolveWorkers(app).map(worker => worker.drain()));
      log(process.stdout, { event: 'SHUTDOWN_WORKERS_DRAINED', signal });
      await app.close();
      log(process.stdout, { event: 'SHUTDOWN_COMPLETED', signal });
    } catch (error) {
      exitCode = 1;
      log(process.stderr, {
        event: 'SHUTDOWN_FAILED',
        signal,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    clearTimeout(forceExit);
    process.exit(exitCode);
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdown(signal));
  }

  // A crash must be visible in the logs without leaking the payload that caused
  // it, so only the error type is recorded.
  process.on('unhandledRejection', reason => {
    log(process.stderr, {
      event: 'UNHANDLED_REJECTION',
      errorType: reason instanceof Error ? reason.name : typeof reason,
    });
  });
  process.on('uncaughtException', error => {
    log(process.stderr, { event: 'UNCAUGHT_EXCEPTION', errorType: error.name });
    void shutdown('SIGTERM');
  });
}
