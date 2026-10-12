import type { AuditConfigInput, WalletReconciliationReport } from './wallet-reconciliation';

/**
 * Pure argument parsing and report serialization for the reconciliation CLI.
 *
 * Kept separate from the Prisma entry point so the operator-facing contract (a
 * typo is refused, a run is exactly one compact JSON line) is unit-testable
 * without a database.
 */

export const RECONCILIATION_CLI_USAGE = [
  'Read-only wallet/ledger reconciliation.',
  '',
  'Usage: node backend/dist/src/operations/wallet-reconciliation.cli.js [options]',
  '',
  'Options:',
  '  --include-references         Add opaque ledger/domain record ids to samples',
  '  --timeout-ms=<n>             Whole-audit transaction timeout (ms)',
  '  --statement-timeout-ms=<n>   Per-statement timeout (ms)',
  '  --sample-limit=<n>           Bounded sample size per failing check',
  '  --help                       Print this message',
  '',
  'Environment: DATABASE_URL is required.',
  '  WALLET_RECONCILIATION_TIMEOUT_MS           whole-audit timeout (default 120000)',
  '  WALLET_RECONCILIATION_STATEMENT_TIMEOUT_MS per-statement timeout (default 60000)',
  '  WALLET_RECONCILIATION_SAMPLE_LIMIT         sample size per check (default 5)',
  '  WALLET_RECONCILIATION_INCLUDE_REFERENCES   record references (default false)',
  '',
  'Output: exactly one compact JSON report line on stdout. Diagnostics go to stderr.',
  'Exit codes: 0 HEALTHY, 1 ANOMALY, 2 INCOMPLETE, 3 SKIPPED_ALREADY_RUNNING',
].join('\n');

export class ReconciliationCliUsageError extends Error {
  constructor(readonly code: string = 'INVALID_ARGUMENT') {
    super(code);
    this.name = 'ReconciliationCliUsageError';
  }
}

export type ParsedReconciliationArguments = {
  input: AuditConfigInput;
  help: boolean;
};

const VALUE_FLAGS: Record<string, keyof AuditConfigInput> = {
  '--timeout-ms': 'transactionTimeoutMs',
  '--statement-timeout-ms': 'statementTimeoutMs',
  '--sample-limit': 'sampleLimit',
};

/**
 * Refuses anything the operator did not mean: an unknown flag, a bare
 * positional argument, a missing value, or a value on a boolean flag. Numeric
 * *range* validation stays with the audit configuration, which reports its own
 * structured error code.
 */
export function parseReconciliationArguments(
  argv: readonly string[],
): ParsedReconciliationArguments {
  const input: AuditConfigInput = {};
  let help = false;

  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    if (argument === '--include-references') {
      input.includeReferences = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new ReconciliationCliUsageError();
    const separator = argument.indexOf('=');
    if (separator === -1) throw new ReconciliationCliUsageError();
    const flag = argument.slice(0, separator);
    const value = argument.slice(separator + 1);
    if (!value) throw new ReconciliationCliUsageError();
    const target = VALUE_FLAGS[flag];
    if (!target) throw new ReconciliationCliUsageError();
    input[target] = value;
  }

  return { input, help };
}

/**
 * One compact JSON line: `JSON.stringify` cannot emit a literal newline, so a
 * single trailing newline keeps a scheduler's `.jsonl` archive one record per
 * run.
 */
export function serializeReconciliationReport(report: WalletReconciliationReport): string {
  return `${JSON.stringify(report)}\n`;
}
