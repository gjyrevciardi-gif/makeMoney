# Wallet and ledger reconciliation (operational control A5)

Read-only operational audit of the virtual-point wallet and ledger. It answers
one question: does the committed wallet/ledger state add up? It never repairs,
never writes a balance, and never touches gameplay, settlement, maths or auth.
The platform's other read-only invariant checker (`scripts/integrity-check.js`)
also covers casino configuration and settlement state; this job is the focused
wallet/ledger control and is safe to schedule on its own.

## What it verifies

`Wallet.balance` is the authoritative total and is compared as an exact BigInt
against the sum of that wallet's `LedgerEntry.amount`. On top of that:

- no wallet balance is negative;
- every ledger amount's sign matches its movement type;
- where `balanceBefore`/`balanceAfter` are recorded they are a consistent pair
  (`balanceBefore + amount = balanceAfter`, or both absent);
- admin and transfer entries name the actor who made them;
- a manager transfer is an equal, opposite pair with the same actor, two
  different wallets, and the `<key>:out` / `<key>:in` pairing;
- every casino ledger movement has its `CasinoTransaction` mirror, and every
  mirror has its ledger movement, matching on idempotency key, round, amount and
  type (`CASINO_BET`/`BET`, `CASINO_WIN`/`WIN`,
  `CASINO_ROLLBACK_REFUND`/`REFUND`);
- a round with a stake carries at least one paid stake debit with its domain
  mirror, so a round whose stake debit, mirror and wallet effect are all missing
  is still detected even though the wallet total stays consistent. The check is
  existence-based on purpose: a blackjack double down adds a second stake debit
  and raises `CasinoRound.stake` to the total, so no "one debit equals the round
  stake" rule is asserted;
- a casino ledger movement and its `CasinoTransaction` belong to the round's
  owner;
- a sports stake debit is exactly `-Bet.stake` for its own bet, owned by the
  wallet owner; every bet carries exactly one such debit;
- a sports settlement credit matches the status its bet implies
  (`WON`/`SPORTS_WIN`, `VOID`/`BET_VOID_REFUND`), belongs to the bet owner, and
  equals `Bet.actualPayout` once the bet records one. A won bet that records no
  payout is the legacy settle path, whose single proven credit is
  `Bet.potentialPayout`; a voided bet with no recorded payout must refund the
  stake. At most one settlement credit per bet;
- a `WON`/`VOID` bet has exactly the one settlement credit it must have.

It deliberately does **not** assert "one `CASINO_WIN` per round". A legitimate
round can credit several times (free features, several actions), so casino wins
are compared per action/idempotency key and per domain movement instead.

### What duplicate detection can and cannot prove

Casino duplicates are detectable only where the schema or the domain mirror
makes them provable: idempotency keys are unique, and each casino ledger
movement must mirror exactly one `CasinoTransaction` for the same round, amount
and type. The audit cannot identify an arbitrary pair of duplicated business
actions that carry distinct idempotency keys and identical amounts — nothing in
the stored record distinguishes them from two legitimate actions.

An `actionId`-based "same action, two credits" check is deliberately NOT
implemented: no writer is proven to guarantee one credit per action across every
integrated game, so such a check could flag a legitimate multi-credit round.
Sports duplicates are provable and are checked (`sports.stake-count`,
`sports.settlement-count`, `sports.settlement-presence`).

## Running it

The command needs `DATABASE_URL` and the compiled backend:

```sh
npm run build --workspace backend          # once per release, or use the image's dist/
DATABASE_URL='postgresql://...' npm run --silent wallet:reconcile
# or, with no npm banner lines at all:
DATABASE_URL='postgresql://...' node backend/dist/src/operations/wallet-reconciliation.cli.js
```

stdout carries exactly one compact JSON line per run, so a scheduler can append
it verbatim to a `.jsonl` anomaly record. Plain `npm run` prints its own banner
lines, so use `npm run --silent` or `node` directly if stdout is parsed.
Diagnostics go to stderr. Neither stream carries a credential, a raw SQL error,
a user id, or a wallet id.

The report is written only after the database handle has been closed, so a
failed cleanup cannot print a `HEALTHY` line and then a second `INCOMPLETE` one:
the run yields one structured outcome either way.

### Options

| Flag | Meaning |
|---|---|
| `--include-references` | add opaque ledger/domain record ids to samples (see below) |
| `--timeout-ms=<n>` | whole-audit transaction timeout |
| `--statement-timeout-ms=<n>` | per-statement timeout |
| `--sample-limit=<n>` | bounded sample size per failing check (1-50) |
| `--help` | usage |

Unknown flags, a bare positional argument, a flag with no value, a value on a
boolean flag and an out-of-range number are all refused with a structured
`INCOMPLETE` report and a non-zero exit code instead of being ignored.

Environment defaults, all bounded and validated before any database work:

| Variable | Default | Accepted range |
|---|---|---|
| `WALLET_RECONCILIATION_TIMEOUT_MS` | 120000 | 1000-3600000 |
| `WALLET_RECONCILIATION_STATEMENT_TIMEOUT_MS` | 60000 | 500-3600000 |
| `WALLET_RECONCILIATION_SAMPLE_LIMIT` | 5 | 1-50 |
| `WALLET_RECONCILIATION_INCLUDE_REFERENCES` | false | true/false |

## Exit codes

| Code | Status | Meaning |
|---|---|---|
| `0` | `HEALTHY` | every check ran and passed |
| `1` | `ANOMALY` | at least one check failed; investigate before trusting balances |
| `2` | `INCOMPLETE` | the audit could not complete (timeout, cancelled statement, failed configuration or connection). Attests nothing; never a pass |
| `3` | `SKIPPED_ALREADY_RUNNING` | another audit of this job holds the lock — a benign overlap, not an incident |

Exit code 3 only means "another run already had the lock"; the scheduler may
treat it as success. Codes 1 and 2 are incidents, and code 2 must never be read
as a clean bill of health.

## Scheduling and overlap

The job holds one transaction-scoped advisory lock for its whole run, taken with
`pg_try_advisory_xact_lock(int4, int4)` under the dedicated `operations`
namespace. That lock space is separate from the one-argument `bigint` locks
every gameplay, settlement and configuration path uses, so this job can never
block a game. A second job started while one is running gets an immediate
`SKIPPED_ALREADY_RUNNING`; there is no polling and no wait loop.

An hourly cron entry, treating exit code 3 as a benign overlap:

```cron
15 * * * * cd /app && DATABASE_URL=... node backend/dist/src/operations/wallet-reconciliation.cli.js >> /var/log/wallet-reconciliation.jsonl 2>> /var/log/wallet-reconciliation.err || [ $? -eq 3 ]
```

The same as a systemd timer (`OnCalendar=hourly`, `Persistent=true`), with
`SuccessExitStatus=3` on the service unit so an overlap is not reported as a
failure. Do not run two schedulers against the same database on overlapping
windows; the lock makes it harmless, but one schedule is easier to reason about.

## Report schema

One JSON object per run:

| Field | Notes |
|---|---|
| `reportVersion` | integer, currently `1` |
| `tool` | `wallet-reconciliation` |
| `status` | `HEALTHY`, `ANOMALY`, `INCOMPLETE`, `SKIPPED_ALREADY_RUNNING` |
| `readOnly` / `isolationLevel` | always `true` and `REPEATABLE READ` |
| `startedAt`, `finishedAt`, `durationMs` | UTC ISO timestamps and duration |
| `configuration` | the resolved, bounded timeouts and sample limit |
| `summary` | `checksDefined`, `checksRun`, `checksFailed`, `violations` |
| `checks[]` | `code`, `title`, `status`, `violationCount`, `durationMs`, `sampleReferences`, `sampleTruncated` |
| `error` | `{ code }` machine-readable, or `null` |

When the status is `INCOMPLETE` the `checks` array is empty and `summary.checksRun`
records how many checks had completed. An `INCOMPLETE` report attests nothing;
no check is ever reported as `PASS` for a run that did not finish, so a timeout
cannot be mistaken for a clean bill of health. Error codes are a small closed
set (`INVALID_TRANSACTION_TIMEOUT`, `INVALID_STATEMENT_TIMEOUT`,
`INVALID_SAMPLE_LIMIT`, `INVALID_INCLUDE_REFERENCES`, `INVALID_ARGUMENT`,
`MISSING_DATABASE_URL`, `TRANSACTION_TIMEOUT`, `STATEMENT_TIMEOUT`,
`DATABASE_ERROR`, `DATABASE_UNAVAILABLE`, `CLEANUP_FAILED`, `AUDIT_FAILED`);
raw SQL text, driver messages and connection strings never appear.

### Identifiers

Every report, default or not, contains no user ids and no wallet ids in any
field. Unless `--include-references` is passed, a report also contains counts
only, with no record identifiers at all. `--include-references` adds the opaque
ledger/domain record id (ledger entry, bet or round) of each sampled violation,
which is what an operator needs to start a trace; wallet ids stay out even then,
because the wallet checks are count-only. Both forms remain operational data:
handle them under the same access and retention rules as other production
operations records, and treat a report produced with `--include-references` as a
restricted operator artifact.

## Consistent read, timeouts and locking

The entire audit runs inside ONE transaction that PostgreSQL itself marks
`READ ONLY` and `REPEATABLE READ`. Every statement therefore sees the same
snapshot: a money movement that commits while the audit is running is either
fully visible or not visible at all, and can never produce a report that mixes
the two states. A write introduced here by accident aborts the transaction
instead of changing data, and the audit takes no ordinary row locks, so it does
not block gameplay writes (it can still consume CPU and I/O — see cost and scale
below).

`statement_timeout` is set for the transaction and the whole audit is bounded by
the transaction timeout. When either fires, the run returns `INCOMPLETE` with a
non-zero exit code. Nothing is written to the database and no audit or balance
row is stored; the scheduler's stdout archive is the anomaly record.

## Incident response

1. Treat `ANOMALY` or `INCOMPLETE` as an operations incident, not a code bug to
   clear. Keep the report.
2. Freeze the affected activity with the existing controls (maintenance
   switches, disabling the account, rotating credentials) rather than editing
   data.
3. Investigate from the append-only ledger: reconcile the wallet against its
   entries, follow the referenced rounds/bets, and compare the audit's snapshot
   with any change since. Never `UPDATE` a balance or a ledger row.
4. If a correction is genuinely required, it must be an approved compensating
   entry written through the audited money paths, reviewed before it is applied.
   This tool never performs it.
5. Re-run the audit after the correction and confirm `HEALTHY` before returning
   the affected activity to service.

## Cost and scale

Each run reads the same tables from several angles: several checks re-scan the
wallets, the ledger and the game-domain movements, so the cost is a set of full
sequential scans inside one snapshot, not one pass per table. `READ ONLY` means
the run writes nothing and takes no ordinary row locks. It does **not** make the
run free: it still consumes CPU and I/O, holds one snapshot for its duration
(which can delay vacuum reclaiming dead rows), and is bounded only by the
statement and transaction timeouts and the per-check sample limit. A large
history therefore means a longer scan and a larger snapshot, which is why a
statement/transaction timeout failure is reported as `INCOMPLETE` rather than a
pass. Size the schedule and the timeouts against the observed run duration for
your database, and keep the run away from peak periods if the scans are
noticeable; no fixed throughput or capacity figure is asserted here.
