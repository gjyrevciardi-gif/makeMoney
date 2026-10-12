# A5 wallet/ledger reconciliation — verification record

Branch `operations/wallet-reconciliation`, base merge `e2dfe412a925a670285056a84d4fdfc31d29d5bd`.
Environment: `bc-astra-pg` @ `127.0.0.1:55440`, dedicated database
`operations_wallet_reconciliation_test` (credentials derived from the container,
never printed). Existing migrations were applied with `prisma migrate deploy`;
no migration was added.

## Round 1 (pre-correction): build, typecheck, focused spec

Run with `DATABASE_URL` pointed at the dedicated test database. The npm commands
ran from the **repository root**; the jest command ran from **`backend/`**, which
is why its path is `../node_modules/...`:

```sh
# repository root
npm run build -w backend                  # build-exit=0
npm run typecheck -w backend              # typecheck-exit=0
# backend/
node --experimental-vm-modules ../node_modules/jest/bin/jest.js \
  --runInBand test/wallet-reconciliation.integration.spec.ts   # jest-exit=0
```

Result: `Test Suites: 1 passed, 1 total` / `Tests: 18 passed, 18 total`
(19.1 s). No correction cycle was needed in that round.

## Pre-validation probes (development, before attempt 1)

- Every check's SQL was executed against the migrated schema:
  `probe-failures=0` for 15 checks.
- The reference-column wrapper (`count(*) OVER () … LIMIT $1`) executed for all
  13 referenced checks: `probe-failures=0`.
- `withReadOnlyAuditTransaction` opened the READ ONLY / REPEATABLE READ
  transaction and acquired the advisory lock: `lock-acquired=true rows=1`.

## Round 1 CLI smoke (compiled `dist`, pre-correction)

| Run | Result |
|---|---|
| healthy database | exit `0`, `status: HEALTHY`, `checksRun: 15`, `checksFailed: 0` |
| `--help` | exit `0` |
| `--timeout-ms=10` (out of range) | exit `2`, `status: INCOMPLETE`, code `INVALID_TRANSACTION_TIMEOUT` |
| seeded unapplied grant (balance ≠ ledger sum) | exit `1`, `status: ANOMALY`, `wallet.balance-mismatch` FAIL, `sampleReferences: []` |

Before/after the anomaly run the database was identical
(`wallets=3 entries=1 transactions=0`), so the audit wrote nothing. The seeded
rows were then removed with a test-database `TRUNCATE` (the ledger's append-only
trigger rejects `UPDATE`/`DELETE`; nothing was disabled).

Round 1 printed the report pretty-printed; the correction round below changed
that to exactly one compact JSON line.

## Round 2 (correction, final): focused spec → typecheck/build → compiled CLI

Same database, same `DATABASE_URL` derivation. Order was exactly as required:
the focused spec first, then typecheck and build, then the compiled CLI.

```sh
# backend/
node --experimental-vm-modules ../node_modules/jest/bin/jest.js \
  --runInBand test/wallet-reconciliation.integration.spec.ts   # jest-exit=0
# repository root
npm run typecheck -w backend                                   # typecheck-exit=0
npm run build -w backend                                       # build-exit=0
```

Result: `Test Suites: 1 passed, 1 total` / `Tests: 23 passed, 23 total`
(19.0 s). The 18 original tests still pass; the 5 new cases are the round-driven
missing paid-stake check, the double-down-shaped healthy round, the settlement
status mismatch, and three CLI contract cases (one compact JSON line, documented
flags, refused flags).

Compiled CLI on the same database:

| Run | Result |
|---|---|
| `--help` | exit `0` |
| healthy database | exit `0`, exactly **1** stdout line, byte-identical to compact JSON (`"status":"HEALTHY"`) |
| `--bogus` (unknown flag) | exit `2`, exactly **1** stdout line, `"INVALID_ARGUMENT"` |
| round with `stake=50` and no ledger row / no `CasinoTransaction` (wallet total consistent) | exit `1`, `"status":"ANOMALY"`, `"checksFailed":1`, failing code `casino.round-missing-stake` |

The anomaly run left `rounds=1 entries=0 transactions=0` unchanged before and
after, so the audit still writes nothing; the fixture was removed with a
test-database `TRUNCATE` afterwards.

## Security limits observed

- One PostgreSQL `REPEATABLE READ` + `READ ONLY` transaction per run.
- Dedicated two-argument advisory lock (`operations:wallet-reconciliation`),
  separate from every gameplay/settlement/config lock namespace.
- No `FOR UPDATE`, no wallet row locks, no writes, no migration, no scheduler.
- Report carries counts and check codes only: no user ids, wallet ids, emails,
  credentials, seeds, tokens or raw SQL text. Record references appear only
  behind `--include-references`.
- Bounded `statement_timeout`, whole-audit transaction timeout, and sample limit.
- stdout is exactly one compact JSON line per run, emitted once after the
  database handle closes.
