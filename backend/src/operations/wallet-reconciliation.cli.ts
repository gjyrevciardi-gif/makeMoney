#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import {
  RECONCILIATION_EXIT_CODES,
  WALLET_RECONCILIATION_CHECKS,
  WALLET_RECONCILIATION_REPORT_VERSION,
  WALLET_RECONCILIATION_TOOL,
  runWalletReconciliation,
  type AuditConfigInput,
  type WalletReconciliationReport,
} from './wallet-reconciliation';
import {
  RECONCILIATION_CLI_USAGE,
  ReconciliationCliUsageError,
  parseReconciliationArguments,
  serializeReconciliationReport,
} from './wallet-reconciliation.cli-args';

/**
 * Operator entry point for the read-only wallet/ledger reconciliation.
 *
 * stdout carries exactly ONE compact JSON report line per run, so a scheduler
 * can append it verbatim to a `.jsonl` anomaly record. Diagnostics go to
 * stderr, and neither stream ever carries a credential, a raw SQL error, a user
 * id or a wallet id. The report is emitted only after the database handle has
 * been closed, so a failed cleanup yields one structured outcome instead of a
 * `HEALTHY` line followed by an `INCOMPLETE` one.
 */

let emitted = false;

function emit(report: WalletReconciliationReport): void {
  if (emitted) return;
  emitted = true;
  process.stdout.write(serializeReconciliationReport(report));
}

/** One structured, non-pretty outcome for any failure that is not a full run. */
function incompleteOutcome(
  code: string,
  source: WalletReconciliationReport | null = null,
): WalletReconciliationReport {
  const timestamp = new Date().toISOString();
  const startedAt = source?.startedAt ?? timestamp;
  return {
    reportVersion: WALLET_RECONCILIATION_REPORT_VERSION,
    tool: WALLET_RECONCILIATION_TOOL,
    status: 'INCOMPLETE',
    readOnly: true,
    isolationLevel: 'REPEATABLE READ',
    startedAt,
    finishedAt: timestamp,
    durationMs: Math.max(0, Date.parse(timestamp) - Date.parse(startedAt)),
    configuration: source?.configuration ?? {
      transactionTimeoutMs: 0,
      statementTimeoutMs: 0,
      sampleLimit: 0,
      includeReferences: false,
    },
    summary: {
      checksDefined: WALLET_RECONCILIATION_CHECKS.length,
      checksRun: source?.summary.checksRun ?? 0,
      checksFailed: 0,
      violations: 0,
    },
    checks: [],
    error: { code },
  };
}

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseReconciliationArguments(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof ReconciliationCliUsageError ? error.code : 'INVALID_ARGUMENT';
    process.stderr.write(`wallet-reconciliation: invalid arguments (${code}); see --help.\n`);
    emit(incompleteOutcome(code));
    return RECONCILIATION_EXIT_CODES.INCOMPLETE;
  }
  if (parsed.help) {
    process.stdout.write(`${RECONCILIATION_CLI_USAGE}\n`);
    return 0;
  }

  const merged: AuditConfigInput = {
    transactionTimeoutMs:
      parsed.input.transactionTimeoutMs ?? process.env.WALLET_RECONCILIATION_TIMEOUT_MS,
    statementTimeoutMs:
      parsed.input.statementTimeoutMs ?? process.env.WALLET_RECONCILIATION_STATEMENT_TIMEOUT_MS,
    sampleLimit: parsed.input.sampleLimit ?? process.env.WALLET_RECONCILIATION_SAMPLE_LIMIT,
    includeReferences:
      parsed.input.includeReferences ?? process.env.WALLET_RECONCILIATION_INCLUDE_REFERENCES,
  };

  if (!process.env.DATABASE_URL) {
    process.stderr.write('wallet-reconciliation: DATABASE_URL is not set.\n');
    emit(incompleteOutcome('MISSING_DATABASE_URL'));
    return RECONCILIATION_EXIT_CODES.INCOMPLETE;
  }

  const prisma = new PrismaClient();
  let report: WalletReconciliationReport | null = null;
  let auditFailure = false;
  try {
    report = await runWalletReconciliation(prisma, { config: merged });
  } catch {
    auditFailure = true;
  }

  let cleanupFailed = false;
  try {
    await prisma.$disconnect();
  } catch {
    cleanupFailed = true;
  }

  // Emit once, after cleanup: a failed disconnect can never append a second
  // report behind an already printed HEALTHY line.
  const outcome = auditFailure
    ? incompleteOutcome('AUDIT_FAILED', report)
    : cleanupFailed && report?.status === 'HEALTHY'
      ? incompleteOutcome('CLEANUP_FAILED', report)
      : report;
  if (!outcome) {
    emit(incompleteOutcome('AUDIT_FAILED', report));
    return RECONCILIATION_EXIT_CODES.INCOMPLETE;
  }
  emit(outcome);
  return RECONCILIATION_EXIT_CODES[outcome.status];
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // The error name only: a driver message can carry the connection string.
    process.stderr.write(
      `wallet-reconciliation: audit could not complete (${error instanceof Error ? error.name : 'UnknownError'}).\n`,
    );
    if (!emitted) {
      emit(incompleteOutcome('AUDIT_FAILED'));
      process.exitCode = RECONCILIATION_EXIT_CODES.INCOMPLETE;
    }
  });
