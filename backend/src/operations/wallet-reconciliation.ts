import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Read-only wallet/ledger operational reconciliation (operational control A5).
 *
 * This module answers one question, and only that question: does the committed
 * wallet and ledger state add up? It never repairs, moves, or writes money, and
 * it never changes a balance. The whole audit runs inside ONE PostgreSQL
 * transaction that the server itself marks REPEATABLE READ and READ ONLY, so a
 * money movement that commits while the audit is running can never make the
 * report see half of it, and a write introduced here by accident is refused by
 * PostgreSQL rather than applied.
 *
 * Conventions this audit relies on were read out of the writers, not assumed:
 *
 *  - `Wallet.balance` is the only authoritative total and must equal the exact
 *    BigInt sum of that wallet's `LedgerEntry.amount`.
 *  - Every casino money movement writes an immutable `LedgerEntry` and a
 *    game-domain `CasinoTransaction` under the SAME idempotency key, the same
 *    round, the same sign and the matching type pair
 *    (`CASINO_BET`/`BET`, `CASINO_WIN`/`WIN`, `CASINO_ROLLBACK_REFUND`/`REFUND`).
 *    This holds for the first-party round service and for every integrated game.
 *  - A round with a stake is opened together with its paid stake debit, and a
 *    blackjack double down adds a SECOND debit while raising `CasinoRound.stake`
 *    to the total, so the round-driven check asserts a paid stake debit EXISTS
 *    and never that one entry equals the (possibly doubled) round stake.
 *  - A round's `payout` is the total of the winning movements credited to it in
 *    the same transaction, so the round-driven payout check compares `payout`
 *    with the SUM of that round's `CASINO_WIN` movements (each mirrored), never
 *    with a single credit.
 *  - Imported-game ledger rows also carry `balanceBefore`/`balanceAfter`; where
 *    they are present they must satisfy `balanceBefore + amount = balanceAfter`.
 *  - A sports stake debit is exactly `-Bet.stake` for its own bet; a settlement
 *    credit must be of the type its bet's status implies (`WON`/`SPORTS_WIN`,
 *    `VOID`/`BET_VOID_REFUND`) and, once the bet records a payout, equal it. A
 *    won bet that records no payout is the legacy settle path, whose single
 *    proven credit is `Bet.potentialPayout`.
 *  - A manager transfer is a `TRANSFER_OUT`/`TRANSFER_IN` pair with the same
 *    magnitude, opposite sign, the same actor and the two different wallets,
 *    keyed `<key>:out` / `<key>:in`.
 *
 * Deliberately NOT asserted: "one CASINO_WIN per round". A legitimate round can
 * credit several times (free features, several actions), so wins are compared
 * per action/idempotency key and per domain movement instead.
 *
 * The report is versioned and answers two separate questions: per check,
 * whether a failure is proven by the stored records themselves
 * (`STORED_RECORD_CONTRADICTION`) or depends on the current model's coverage
 * (`CURRENT_MODEL_INVARIANT`); and, report-wide, how much before/after
 * transition evidence was even available (`coverage`). See the types below for
 * the exact contract.
 */

export const WALLET_RECONCILIATION_REPORT_VERSION = 2 as const;
export const WALLET_RECONCILIATION_TOOL = 'wallet-reconciliation' as const;

/**
 * Dedicated advisory-lock identity for this audit job only.
 *
 * The two-argument `pg_try_advisory_xact_lock(int4, int4)` form lives in a
 * separate lock space from the one-argument `bigint` form every gameplay,
 * settlement and config path uses, so this job can never collide with a game
 * lock even by hash accident.
 */
export const AUDIT_LOCK_NAMESPACE = 'operations:wallet-reconciliation' as const;
export const AUDIT_LOCK_RESOURCE = 'audit-job' as const;

export const DEFAULT_TRANSACTION_TIMEOUT_MS = 120_000;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 60_000;
export const DEFAULT_SAMPLE_LIMIT = 5;

export const MIN_TRANSACTION_TIMEOUT_MS = 1_000;
export const MAX_TRANSACTION_TIMEOUT_MS = 3_600_000;
export const MIN_STATEMENT_TIMEOUT_MS = 500;
export const MAX_STATEMENT_TIMEOUT_MS = 3_600_000;
export const MIN_SAMPLE_LIMIT = 1;
export const MAX_SAMPLE_LIMIT = 50;

export const RECONCILIATION_EXIT_CODES = {
  HEALTHY: 0,
  ANOMALY: 1,
  INCOMPLETE: 2,
  SKIPPED_ALREADY_RUNNING: 3,
} as const;

export type ReconciliationStatus = keyof typeof RECONCILIATION_EXIT_CODES;
export type ReconciliationCheckStatus = 'PASS' | 'FAIL';

/**
 * How a finding must be read, so a model-shaped observation is never presented
 * as a mathematical contradiction.
 *
 * `STORED_RECORD_CONTRADICTION` — every way the check can fail is proven by
 * stored values that both exist: two records disagree, or one record
 * contradicts its own recorded arithmetic. No coverage assumption changes that.
 *
 * `CURRENT_MODEL_INVARIANT` — the check holds for data written by the current
 * model, and it can also fail because a required record or value is ABSENT. That
 * absence is a breach of the current model, but this snapshot alone cannot
 * certify it as an arithmetic impossibility: data written outside the current
 * model (a pre-coverage import, or an opening baseline the model does not
 * support) would look the same.
 */
export type ReconciliationFindingBasis =
  | 'STORED_RECORD_CONTRADICTION'
  | 'CURRENT_MODEL_INVARIANT';

export type AuditConfig = {
  transactionTimeoutMs: number;
  statementTimeoutMs: number;
  sampleLimit: number;
  includeReferences: boolean;
};

export type AuditConfigInput = {
  transactionTimeoutMs?: number | string;
  statementTimeoutMs?: number | string;
  sampleLimit?: number | string;
  includeReferences?: boolean | string;
};

export type ReconciliationCheckResult = {
  code: string;
  title: string;
  /** Reading key for a FAIL; present for passes too, so the contract is visible. */
  findingBasis: ReconciliationFindingBasis;
  status: ReconciliationCheckStatus;
  violationCount: number;
  durationMs: number;
  /**
   * Opaque ledger/domain record references (ledger entry, bet or round id).
   * Empty unless `includeReferences` is on. User and wallet identifiers are
   * never emitted, with or without this option.
   */
  sampleReferences: string[];
  sampleTruncated: boolean;
};

/**
 * What the snapshot could actually verify, stated separately from what it
 * found.
 *
 * `unavailable` rows have no recorded before/after transition at all: that is
 * UNVERIFIABLE evidence — neither zero movement nor proof of balance
 * corruption — and it is deliberately not an anomaly. `partial` rows carry
 * exactly one side, which the current model never writes, and are reported by
 * `ledger.balance-provenance-incomplete`.
 */
export type LedgerTransitionCoverage = {
  total: number;
  verified: number;
  unavailable: number;
  partial: number;
};

export type WalletReconciliationReport = {
  reportVersion: typeof WALLET_RECONCILIATION_REPORT_VERSION;
  tool: typeof WALLET_RECONCILIATION_TOOL;
  status: ReconciliationStatus;
  readOnly: true;
  isolationLevel: 'REPEATABLE READ';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  configuration: AuditConfig;
  summary: {
    checksDefined: number;
    checksRun: number;
    checksFailed: number;
    violations: number;
  };
  /**
   * Snapshot-consistent coverage. `HEALTHY` means no anomaly was detected in
   * the evidence that is present; it is not a statement about rows whose
   * evidence is absent, which is why this object travels with the report.
   */
  coverage: {
    balanceProvenance: LedgerTransitionCoverage;
  };
  checks: ReconciliationCheckResult[];
  /**
   * Machine-readable failure code only. Raw SQL text, driver messages and
   * connection strings never reach this field.
   */
  error: { code: string } | null;
};

export class AuditConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AuditConfigurationError';
  }
}

/** The minimum Prisma surface the audit needs; a plain client satisfies it. */
export type TransactionHost = { $transaction: PrismaClient['$transaction'] };
export type AuditClient = Prisma.TransactionClient;

export type AuditHooks = {
  /**
   * Runs after one check has finished and before the next one starts. It
   * receives the audit transaction so a test can prove that the transaction
   * keeps one fixed snapshot across steps. Not used in production runs.
   */
  afterStep?: (context: { index: number; code: string; tx: AuditClient }) => Promise<void> | void;
};

export type CheckDefinition = {
  code: string;
  title: string;
  /** How a failure of this check must be read (see ReconciliationFindingBasis). */
  findingBasis: ReconciliationFindingBasis;
  /**
   * Column alias produced by `sql` that identifies the offending record with an
   * opaque domain/ledger reference, or null for count-only checks (wallet
   * checks, whose only identifier would be a wallet id).
   */
  referenceColumn: string | null;
  sql: string;
};

/**
 * Every check below describes the BROKEN state: an empty result is a pass.
 *
 * Some of these can only occur if the schema's own constraints have drifted
 * (PostgreSQL already refuses a negative balance, a wrong amount sign, or an
 * unattributed admin/transfer entry). They stay in the audit as drift
 * detectors, which is exactly what a restored pre-constraint dump needs.
 */
export const WALLET_RECONCILIATION_CHECKS: readonly CheckDefinition[] = [
  {
    code: 'wallet.balance-mismatch',
    title: 'wallet balance equals the exact BigInt sum of its ledger entries',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: null,
    sql: `
      SELECT w."id"
      FROM "Wallet" w
      LEFT JOIN (
        SELECT "walletId" AS wallet_id, SUM("amount") AS total
        FROM "LedgerEntry"
        GROUP BY "walletId"
      ) l ON l.wallet_id = w."id"
      WHERE w."balance" <> COALESCE(l.total, 0)
    `,
  },
  {
    code: 'wallet.balance-negative',
    title: 'no wallet balance is negative',
    findingBasis: 'STORED_RECORD_CONTRADICTION',
    referenceColumn: null,
    sql: `SELECT "id" FROM "Wallet" WHERE "balance" < 0`,
  },
  {
    code: 'ledger.amount-sign',
    title: 'every ledger amount sign matches its movement type',
    findingBasis: 'STORED_RECORD_CONTRADICTION',
    referenceColumn: 'ref',
    sql: `
      SELECT "id" AS ref
      FROM "LedgerEntry"
      WHERE ("type" IN ('ADMIN_GRANT', 'SPORTS_WIN', 'CASINO_WIN', 'BET_VOID_REFUND', 'CASINO_ROLLBACK_REFUND', 'TRANSFER_IN')
             AND "amount" <= 0)
         OR ("type" IN ('ADMIN_REMOVE', 'SPORTS_BET', 'CASINO_BET', 'TRANSFER_OUT')
             AND "amount" >= 0)
    `,
  },
  {
    code: 'ledger.balance-provenance',
    title: 'a complete recorded balanceBefore/balanceAfter pair satisfies its own arithmetic',
    findingBasis: 'STORED_RECORD_CONTRADICTION',
    referenceColumn: 'ref',
    sql: `
      SELECT "id" AS ref
      FROM "LedgerEntry"
      WHERE "balanceBefore" IS NOT NULL
        AND "balanceAfter" IS NOT NULL
        AND "balanceBefore" + "amount" <> "balanceAfter"
    `,
  },
  {
    code: 'ledger.balance-provenance-incomplete',
    title: 'a recorded transition carries both of its balance sides or neither',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT "id" AS ref
      FROM "LedgerEntry"
      WHERE ("balanceBefore" IS NULL) <> ("balanceAfter" IS NULL)
    `,
  },
  {
    code: 'ledger.attribution',
    title: 'admin and transfer entries name the actor who made them',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT "id" AS ref
      FROM "LedgerEntry"
      WHERE "type" IN ('ADMIN_GRANT', 'ADMIN_REMOVE', 'TRANSFER_IN', 'TRANSFER_OUT')
        AND "actorId" IS NULL
    `,
  },
  {
    code: 'ledger.transfer-pairing',
    title: 'every manager transfer has its equal, opposite, same-actor partner in another wallet',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT l."id" AS ref
      FROM "LedgerEntry" l
      WHERE (l."type" = 'TRANSFER_OUT' AND (
               l."idempotencyKey" NOT LIKE '%:out'
               OR NOT EXISTS (
                 SELECT 1 FROM "LedgerEntry" p
                 WHERE p."type" = 'TRANSFER_IN'
                   AND p."idempotencyKey" = left(l."idempotencyKey", length(l."idempotencyKey") - 4) || ':in'
                   AND p."amount" = -l."amount"
                   AND p."actorId" = l."actorId"
                   AND p."walletId" <> l."walletId"
               )))
         OR (l."type" = 'TRANSFER_IN' AND (
               l."idempotencyKey" NOT LIKE '%:in'
               OR NOT EXISTS (
                 SELECT 1 FROM "LedgerEntry" p
                 WHERE p."type" = 'TRANSFER_OUT'
                   AND p."idempotencyKey" = left(l."idempotencyKey", length(l."idempotencyKey") - 3) || ':out'
                   AND p."amount" = -l."amount"
                   AND p."actorId" = l."actorId"
                   AND p."walletId" <> l."walletId"
               )))
    `,
  },
  {
    code: 'casino.ledger-without-transaction',
    title: 'every casino ledger movement has its matching CasinoTransaction',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT l."id" AS ref
      FROM "LedgerEntry" l
      WHERE l."type" IN ('CASINO_BET', 'CASINO_WIN', 'CASINO_ROLLBACK_REFUND')
        AND NOT EXISTS (
          SELECT 1 FROM "CasinoTransaction" t
          WHERE t."idempotencyKey" = l."idempotencyKey"
            AND t."roundId" = l."relatedCasinoRoundId"
            AND t."amount" = l."amount"
            AND ((l."type" = 'CASINO_BET' AND t."type" = 'BET')
              OR (l."type" = 'CASINO_WIN' AND t."type" = 'WIN')
              OR (l."type" = 'CASINO_ROLLBACK_REFUND' AND t."type" = 'REFUND'))
        )
    `,
  },
  {
    code: 'casino.transaction-without-ledger',
    title: 'every CasinoTransaction has its matching ledger movement',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT t."id" AS ref
      FROM "CasinoTransaction" t
      WHERE NOT EXISTS (
        SELECT 1 FROM "LedgerEntry" l
        WHERE l."idempotencyKey" = t."idempotencyKey"
          AND l."relatedCasinoRoundId" = t."roundId"
          AND l."amount" = t."amount"
          AND ((t."type" = 'BET' AND l."type" = 'CASINO_BET')
            OR (t."type" = 'WIN' AND l."type" = 'CASINO_WIN')
            OR (t."type" = 'REFUND' AND l."type" = 'CASINO_ROLLBACK_REFUND'))
      )
    `,
  },
  {
    // Round-driven, so it still fires when the ledger movement, the domain
    // mirror and the wallet effect are ALL missing and the wallet sum is
    // trivially consistent. Existence only: a double-down legitimately adds a
    // second stake debit and raises CasinoRound.stake to the total, so any
    // "one debit equals the round stake" rule would be wrong.
    code: 'casino.round-missing-stake',
    title: 'a round with a stake carries its paid stake debit and domain mirror',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT r."id" AS ref
      FROM "CasinoRound" r
      WHERE r."stake" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "LedgerEntry" l
          JOIN "CasinoTransaction" t
            ON t."idempotencyKey" = l."idempotencyKey"
           AND t."roundId" = l."relatedCasinoRoundId"
           AND t."amount" = l."amount"
           AND t."type" = 'BET'
          WHERE l."relatedCasinoRoundId" = r."id"
            AND l."type" = 'CASINO_BET'
        )
    `,
  },
  {
    // The mirror image of the stake check, and the same silent-pass shape: a
    // round that records a payout with no winning credit at all leaves the
    // wallet and ledger totals in agreement. Summed rather than bounded to one
    // row, because more than one credit for a round is legitimate; every
    // writer stores `payout` as exactly the amount (or the total of the
    // amounts) it credits in the same transaction, and every credit has its
    // own domain mirror.
    code: 'casino.round-missing-win',
    title: 'a round payout is carried by its winning ledger movements and domain mirrors',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT r."id" AS ref
      FROM "CasinoRound" r
      LEFT JOIN (
        SELECT l."relatedCasinoRoundId" AS round_id, SUM(l."amount") AS total
        FROM "LedgerEntry" l
        JOIN "CasinoTransaction" t
          ON t."idempotencyKey" = l."idempotencyKey"
         AND t."roundId" = l."relatedCasinoRoundId"
         AND t."amount" = l."amount"
         AND t."type" = 'WIN'
        WHERE l."type" = 'CASINO_WIN'
        GROUP BY l."relatedCasinoRoundId"
      ) w ON w.round_id = r."id"
      WHERE COALESCE(w.total, 0) <> r."payout"
    `,
  },
  {
    code: 'casino.round-ownership',
    title: 'a casino ledger movement belongs to its round owner',
    findingBasis: 'STORED_RECORD_CONTRADICTION',
    referenceColumn: 'ref',
    sql: `
      SELECT l."id" AS ref
      FROM "LedgerEntry" l
      JOIN "Wallet" w ON w."id" = l."walletId"
      JOIN "CasinoRound" r ON r."id" = l."relatedCasinoRoundId"
      WHERE r."userId" <> w."userId"
    `,
  },
  {
    code: 'casino.transaction-ownership',
    title: 'a CasinoTransaction belongs to its round owner',
    findingBasis: 'STORED_RECORD_CONTRADICTION',
    referenceColumn: 'ref',
    sql: `
      SELECT t."id" AS ref
      FROM "CasinoTransaction" t
      JOIN "CasinoRound" r ON r."id" = t."roundId"
      WHERE t."userId" <> r."userId"
    `,
  },
  {
    // A missing reference is a drift detector: the NOT NULL check plus the
    // foreign key make it unreachable while the schema holds, and the current
    // model never writes a sports movement without its bet.
    code: 'ledger.sports-bet-reference-missing',
    title: 'a sports ledger movement resolves to the bet it references',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT l."id" AS ref
      FROM "LedgerEntry" l
      WHERE l."type" IN ('SPORTS_BET', 'SPORTS_WIN', 'BET_VOID_REFUND')
        AND NOT EXISTS (SELECT 1 FROM "Bet" b WHERE b."id" = l."relatedBetId")
    `,
  },
  {
    code: 'sports.stake-linkage',
    title: 'a sports stake debit is exactly its own bet stake, owned by the wallet owner',
    findingBasis: 'STORED_RECORD_CONTRADICTION',
    referenceColumn: 'ref',
    sql: `
      SELECT l."id" AS ref
      FROM "LedgerEntry" l
      JOIN "Wallet" w ON w."id" = l."walletId"
      JOIN "Bet" b ON b."id" = l."relatedBetId"
      WHERE l."type" = 'SPORTS_BET'
        AND (b."userId" <> w."userId" OR l."amount" <> -b."stake")
    `,
  },
  {
    code: 'sports.stake-count',
    title: 'every bet carries exactly one stake debit of its own stake',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT b."id" AS ref
      FROM "Bet" b
      LEFT JOIN (
        SELECT "relatedBetId" AS bet_id, COUNT(*) AS entries, COALESCE(SUM("amount"), 0) AS total
        FROM "LedgerEntry"
        WHERE "type" = 'SPORTS_BET'
        GROUP BY "relatedBetId"
      ) l ON l.bet_id = b."id"
      WHERE COALESCE(l.entries, 0) <> 1 OR l.total <> -b."stake"
    `,
  },
  {
    code: 'sports.settlement-linkage',
    title: 'a sports settlement credit matches its bet status, owner and recorded payout',
    findingBasis: 'STORED_RECORD_CONTRADICTION',
    referenceColumn: 'ref',
    sql: `
      SELECT l."id" AS ref
      FROM "LedgerEntry" l
      JOIN "Wallet" w ON w."id" = l."walletId"
      JOIN "Bet" b ON b."id" = l."relatedBetId"
      WHERE l."type" IN ('SPORTS_WIN', 'BET_VOID_REFUND')
        AND (b."userId" <> w."userId"
          OR (l."type" = 'SPORTS_WIN' AND b."status" <> 'WON')
          OR (l."type" = 'BET_VOID_REFUND' AND b."status" <> 'VOID')
          OR (b."actualPayout" IS NOT NULL AND l."amount" <> b."actualPayout"))
    `,
  },
  {
    // The legacy settle path records WON/VOID with no payout column, and the
    // only amount its writer proves is the potential payout (won) or the stake
    // (void). That is a statement about which writers exist and how they cover
    // the bet, not an arithmetic contradiction between two stored values.
    code: 'sports.settlement-linkage-legacy',
    title: 'a settlement credit on a bet without a recorded payout matches the amount its writer proves',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT l."id" AS ref
      FROM "LedgerEntry" l
      JOIN "Bet" b ON b."id" = l."relatedBetId"
      WHERE l."type" IN ('SPORTS_WIN', 'BET_VOID_REFUND')
        AND b."actualPayout" IS NULL
        AND ((b."status" = 'WON' AND l."amount" <> b."potentialPayout")
          OR (b."status" = 'VOID' AND l."amount" <> b."stake"))
    `,
  },
  {
    code: 'sports.settlement-count',
    title: 'a bet is settled by at most one settlement credit',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT b."id" AS ref
      FROM "Bet" b
      WHERE (
        SELECT COUNT(*) FROM "LedgerEntry" l
        WHERE l."relatedBetId" = b."id" AND l."type" IN ('SPORTS_WIN', 'BET_VOID_REFUND')
      ) > 1
    `,
  },
  {
    code: 'sports.settlement-presence',
    title: 'a won or voided bet has exactly the one settlement credit it must have',
    findingBasis: 'CURRENT_MODEL_INVARIANT',
    referenceColumn: 'ref',
    sql: `
      SELECT b."id" AS ref
      FROM "Bet" b
      WHERE (b."status" = 'WON' AND (
               SELECT COUNT(*) FROM "LedgerEntry" l
               WHERE l."relatedBetId" = b."id" AND l."type" = 'SPORTS_WIN'
             ) <> 1)
         OR (b."status" = 'VOID' AND (
               SELECT COUNT(*) FROM "LedgerEntry" l
               WHERE l."relatedBetId" = b."id" AND l."type" = 'BET_VOID_REFUND'
             ) <> 1)
    `,
  },
];

const configErrorCodes: Record<keyof AuditConfigInput, string> = {
  transactionTimeoutMs: 'INVALID_TRANSACTION_TIMEOUT',
  statementTimeoutMs: 'INVALID_STATEMENT_TIMEOUT',
  sampleLimit: 'INVALID_SAMPLE_LIMIT',
  includeReferences: 'INVALID_INCLUDE_REFERENCES',
};

function parseBoundedInteger(
  value: number | string | undefined,
  fallback: number,
  min: number,
  max: number,
  code: string,
): number {
  if (value === undefined || value === '') return fallback;
  const text = typeof value === 'number' ? String(value) : value.trim();
  if (!/^\d+$/.test(text)) throw new AuditConfigurationError(code);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new AuditConfigurationError(code);
  }
  return parsed;
}

function parseBoolean(value: boolean | string | undefined, code: string): boolean {
  if (value === undefined || value === '') return false;
  if (typeof value === 'boolean') return value;
  const text = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  throw new AuditConfigurationError(code);
}

/**
 * Bounds every knob an operator can set, so no configuration can silently
 * remove the audit's time limits.
 */
export function resolveAuditConfig(input: AuditConfigInput = {}): AuditConfig {
  return {
    transactionTimeoutMs: parseBoundedInteger(
      input.transactionTimeoutMs,
      DEFAULT_TRANSACTION_TIMEOUT_MS,
      MIN_TRANSACTION_TIMEOUT_MS,
      MAX_TRANSACTION_TIMEOUT_MS,
      configErrorCodes.transactionTimeoutMs,
    ),
    statementTimeoutMs: parseBoundedInteger(
      input.statementTimeoutMs,
      DEFAULT_STATEMENT_TIMEOUT_MS,
      MIN_STATEMENT_TIMEOUT_MS,
      MAX_STATEMENT_TIMEOUT_MS,
      configErrorCodes.statementTimeoutMs,
    ),
    sampleLimit: parseBoundedInteger(
      input.sampleLimit,
      DEFAULT_SAMPLE_LIMIT,
      MIN_SAMPLE_LIMIT,
      MAX_SAMPLE_LIMIT,
      configErrorCodes.sampleLimit,
    ),
    includeReferences: parseBoolean(input.includeReferences, configErrorCodes.includeReferences),
  };
}

export type AuditLockOutcome<T> = { acquired: false } | { acquired: true; value: T };

/**
 * Opens the audit transaction and runs `work` inside it.
 *
 * Guarantees, all enforced by PostgreSQL rather than by convention:
 *  - `SET TRANSACTION READ ONLY` makes any write from `work` abort the
 *    transaction instead of changing data;
 *  - REPEATABLE READ fixes one snapshot for every statement in `work`, so a
 *    movement committed between steps cannot be seen half-applied;
 *  - a bounded `statement_timeout` cancels one runaway statement, and the
 *    bounded Prisma transaction timeout cancels a runaway audit;
 *  - `pg_try_advisory_xact_lock` gives a second concurrent job an immediate
 *    false, never a wait;
 *  - no wallet row is locked, so ordinary gameplay is never blocked.
 */
export async function withReadOnlyAuditTransaction<T>(
  host: TransactionHost,
  config: AuditConfig,
  work: (tx: AuditClient) => Promise<T>,
): Promise<AuditLockOutcome<T>> {
  return host.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$queryRaw(
        Prisma.sql`SELECT set_config('statement_timeout', ${String(config.statementTimeoutMs)}, true)`,
      );
      const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(
          hashtext(${AUDIT_LOCK_NAMESPACE}),
          hashtext(${AUDIT_LOCK_RESOURCE})
        ) AS locked`,
      );
      if (lockRows[0]?.locked !== true) return { acquired: false } as const;
      return { acquired: true, value: await work(tx) } as const;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: config.transactionTimeoutMs,
      timeout: config.transactionTimeoutMs,
    },
  );
}

async function runCheck(
  tx: AuditClient,
  definition: CheckDefinition,
  sampleLimit: number,
): Promise<{ total: number; references: string[] }> {
  if (!definition.referenceColumn) {
    const rows = await tx.$queryRawUnsafe<Array<{ total: bigint }>>(
      `SELECT count(*)::bigint AS total FROM (${definition.sql}) AS v`,
    );
    return { total: Number(rows[0]?.total ?? 0), references: [] };
  }

  const rows = await tx.$queryRawUnsafe<Array<{ ref: string; total: bigint }>>(
    `SELECT v."${definition.referenceColumn}" AS ref, count(*) OVER () AS total
     FROM (${definition.sql}) AS v
     ORDER BY 1
     LIMIT $1`,
    sampleLimit,
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    references: rows.map((row) => String(row.ref)),
  };
}

const INVALID_CONFIGURATION = 'INVALID_CONFIGURATION';

/**
 * Nothing is attested unless the run completed, so every unattested outcome
 * reports empty coverage rather than a partial count.
 */
export const EMPTY_LEDGER_TRANSITION_COVERAGE: LedgerTransitionCoverage = {
  total: 0,
  verified: 0,
  unavailable: 0,
  partial: 0,
};

/**
 * Reads the snapshot-consistent coverage of the before/after transition
 * evidence in one aggregate statement, inside the audit transaction. A row with
 * neither side recorded is UNVERIFIABLE evidence: it is counted here and is
 * deliberately not a failure.
 */
async function readLedgerTransitionCoverage(tx: AuditClient): Promise<LedgerTransitionCoverage> {
  const rows = await tx.$queryRawUnsafe<
    Array<{ total: bigint; verified: bigint; unavailable: bigint; partial: bigint }>
  >(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE "balanceBefore" IS NOT NULL AND "balanceAfter" IS NOT NULL) AS verified,
            count(*) FILTER (WHERE "balanceBefore" IS NULL AND "balanceAfter" IS NULL) AS unavailable,
            count(*) FILTER (WHERE ("balanceBefore" IS NULL) <> ("balanceAfter" IS NULL)) AS partial
     FROM "LedgerEntry"`,
  );
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    verified: Number(row?.verified ?? 0),
    unavailable: Number(row?.unavailable ?? 0),
    partial: Number(row?.partial ?? 0),
  };
}

/**
 * Maps an error to a machine-readable code without ever surfacing driver text,
 * SQL or connection details.
 */
export function classifyAuditError(error: unknown): string {
  const candidate = error as { code?: unknown; meta?: { code?: unknown } } | null;
  const code = candidate?.code;
  if (code === 'P2028') return 'TRANSACTION_TIMEOUT';
  if (code === '57014') return 'STATEMENT_TIMEOUT';
  if (code === 'P2010') {
    return candidate?.meta?.code === '57014' ? 'STATEMENT_TIMEOUT' : 'DATABASE_ERROR';
  }
  if (typeof code === 'string' && code.startsWith('P1')) return 'DATABASE_UNAVAILABLE';
  return 'AUDIT_FAILED';
}

export type RunWalletReconciliationOptions = {
  config?: AuditConfigInput;
  hooks?: AuditHooks;
};

function buildReport(input: {
  status: ReconciliationStatus;
  startedAt: Date;
  configuration: AuditConfig;
  checks: ReconciliationCheckResult[];
  checksRun: number;
  coverage?: LedgerTransitionCoverage;
  error: { code: string } | null;
}): WalletReconciliationReport {
  const finishedAt = new Date();
  const checksFailed = input.checks.filter((check) => check.status === 'FAIL').length;
  return {
    reportVersion: WALLET_RECONCILIATION_REPORT_VERSION,
    tool: WALLET_RECONCILIATION_TOOL,
    status: input.status,
    readOnly: true,
    isolationLevel: 'REPEATABLE READ',
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - input.startedAt.getTime(),
    configuration: input.configuration,
    summary: {
      checksDefined: WALLET_RECONCILIATION_CHECKS.length,
      checksRun: input.checksRun,
      checksFailed,
      violations: input.checks.reduce((total, check) => total + check.violationCount, 0),
    },
    coverage: { balanceProvenance: input.coverage ?? EMPTY_LEDGER_TRANSITION_COVERAGE },
    checks: input.checks,
    error: input.error,
  };
}

/**
 * Runs the full audit once and returns a versioned, machine-readable report.
 *
 * An `INCOMPLETE` report attests nothing: when any statement or the transaction
 * fails, `checks` is emptied and the status stays distinct from `HEALTHY`, so a
 * timeout or an aborted transaction can never be read as a pass.
 */
export async function runWalletReconciliation(
  host: TransactionHost,
  options: RunWalletReconciliationOptions = {},
): Promise<WalletReconciliationReport> {
  const startedAt = new Date();
  let config: AuditConfig;
  try {
    config = resolveAuditConfig(options.config);
  } catch (error) {
    return buildReport({
      status: 'INCOMPLETE',
      startedAt,
      configuration: {
        transactionTimeoutMs: 0,
        statementTimeoutMs: 0,
        sampleLimit: 0,
        includeReferences: false,
      },
      checks: [],
      checksRun: 0,
      error: {
        code: error instanceof AuditConfigurationError ? error.code : INVALID_CONFIGURATION,
      },
    });
  }

  const completed: ReconciliationCheckResult[] = [];
  try {
    const outcome = await withReadOnlyAuditTransaction(host, config, async (tx) => {
      // Coverage first, in the same fixed snapshot as the checks, so what the
      // report attests and what it could verify can never disagree.
      const coverage = await readLedgerTransitionCoverage(tx);
      for (let index = 0; index < WALLET_RECONCILIATION_CHECKS.length; index += 1) {
        const definition = WALLET_RECONCILIATION_CHECKS[index];
        const stepStarted = Date.now();
        const { total, references } = await runCheck(tx, definition, config.sampleLimit);
        const samples = config.includeReferences && definition.referenceColumn ? references : [];
        completed.push({
          code: definition.code,
          title: definition.title,
          findingBasis: definition.findingBasis,
          status: total > 0 ? 'FAIL' : 'PASS',
          violationCount: total,
          durationMs: Date.now() - stepStarted,
          sampleReferences: samples,
          sampleTruncated: total > samples.length,
        });
        await options.hooks?.afterStep?.({ index, code: definition.code, tx });
      }
      return { coverage, checks: completed };
    });

    if (!outcome.acquired) {
      return buildReport({
        status: 'SKIPPED_ALREADY_RUNNING',
        startedAt,
        configuration: config,
        checks: [],
        checksRun: 0,
        error: null,
      });
    }

    return buildReport({
      status: outcome.value.checks.some((check) => check.status === 'FAIL') ? 'ANOMALY' : 'HEALTHY',
      startedAt,
      configuration: config,
      checks: outcome.value.checks,
      checksRun: outcome.value.checks.length,
      coverage: outcome.value.coverage,
      error: null,
    });
  } catch (error) {
    return buildReport({
      status: 'INCOMPLETE',
      startedAt,
      configuration: config,
      checks: [],
      checksRun: completed.length,
      error: { code: classifyAuditError(error) },
    });
  }
}
