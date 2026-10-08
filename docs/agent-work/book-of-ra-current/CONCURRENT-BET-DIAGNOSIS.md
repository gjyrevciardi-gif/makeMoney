# Concurrent identical bet: diagnosis (no runtime change applied)

Scope: reproduce ONLY `collapses two concurrent identical requests to one debit and one stored
response` and prove the original exception. No runtime code was modified in this task.

## Reproduce command

```text
# isolated local test DB only (boc_classic_test, docker project gat-p0)
node games/book-of-ra-classic/scripts/diagnose-concurrent-bet.cjs      # exit 0, evidence JSON written
```

Harness: `games/book-of-ra-classic/scripts/diagnose-concurrent-bet.cjs` (diagnose-only, adds no runtime).
Evidence: `docs/agent-work/book-of-ra-current/CONCURRENT-BET-DIAGNOSIS.json` (sanitized; no credentials).

## Original exception (not an assertion error)

- class: `PrismaClientKnownRequestError`
- code: `P2002` (unique constraint)
- message: `` Invalid `tx.gamePreparedOutcome.create()` invocation … Unique constraint failed on the
  fields: (`requestKey`) ``
- meta: `{ modelName: 'GamePreparedOutcome', target: ['requestKey'] }`
- stack location: `GameJournalService.prepareOutcome` — `backend/src/casino/platform/game-journal.service.ts`
  (`await tx.gamePreparedOutcome.create({...})`, compiled `dist/.../game-journal.service.js:167`)
- no HTTP status: the rejection happened inside the transaction, before any protocol mapping.

## Both racing outcomes (exact indices from the captured JSON)

- `outcomes[0]`: **rejected** with the P2002 above (this is request A's index in the capture).
- `outcomes[1]`: **fulfilled**, normal `spin` envelope + recovery snapshot (debit once, action booked).
- Both requests carried the SAME `x-pilot-request-id`, so both derived request key `<userId>:<requestId>`.
  The labels "A/B" in the summary above refer to capture indices 0/1, not to winner/loser.

Capture limitation, stated honestly: that run truncated `message` to 600 characters and `stack` to 14
lines, so it is NOT a full-stack capture. The harness now captures the full sanitized message and stack
and refuses to run unless the connection is loopback and `current_database()` is `boc_classic_test`
(verified before any write); the original JSON was preserved unmodified.

No HTTP status was observed at any point: the service-level invocation throws inside the transaction,
so no controller/HTTP mapping was exercised and none is claimed.

## State after both settled

- wallet: `991` (funded `1000`, one `-9` debit)
- ledger: exactly one `CASINO_BET` `-9` with idempotency key, session id and action id
- rounds: exactly one `CasinoRound`, status `OPEN`
- actions for the key: exactly 1 row (seq/`deliveredAt` present); actions for the user: 1
- prepared rows for the key: `0`; prepared rows for the user: `0`

## Root cause (proven, category B — unique constraint, with a same-key retry gap)

The loser acquires the per-player advisory lock only after the winner's **preparation** transaction has
committed, because the paid round is prepared first and settled in a second transaction. At that moment:

- `findReplayIn` finds nothing (the winner has not yet booked its action, so no stored response exists);
- `assertNoForeignPrepared` deliberately permits a row whose `requestKey` equals this request's own key;
- the loser therefore calls `prepareOutcome` and inserts a **second** row for the same `requestKey`,
  which the unique index refuses → `P2002`.

So the race is not lost to the lock, serialization, pool or deadlock: it is that a *same-key* prepared
outcome is not treated as this request's own in-flight state. The settlement path then completed
normally for the winner (one debit, prepared rows cleaned up).

## Proposed minimal runtime correction (NOT applied — awaiting Astra approval)

Preferred (keeps the contract "duplicate returns the stored response"), <= 5 lines, in
`backend/src/casino/games/book-of-ra-classic/classic.adapter.ts` inside `bet()`'s serialized block,
immediately after `await this.journal.assertNoForeignPrepared(...)`:

```ts
// The same request identity may already be prepared by a concurrent duplicate:
// a prepared row for this exact key is this request's own in-flight state, so the
// attempt falls through to settlement instead of inserting a second row.
const own = await this.journal.findPreparedIn(tx, key, userId);
if (own) return { prepared: true as const };
```

Alternate, shared-journal variant (also <= 5 lines) in
`backend/src/casino/platform/game-journal.service.ts` / `prepareOutcome`: catch the create error and map
`error.code === 'P2002'` to `throw this.conflict('SETTLEMENT_PENDING', 'This request is already prepared.')`,
which makes the loser retryable rather than a 500.

Recommendation: the adapter-local variant, because it returns the same stored document to both callers
instead of surfacing a conflict the recovered client does not expect.

## AFTER the approved bounded correction (applied, adapter-local only)

Runtime change: 8 changed lines in `backend/src/casino/games/book-of-ra-classic/classic.adapter.ts`
(3 comment lines + 5 code lines) inside `bet()`'s serialized block, immediately after
`assertNoForeignPrepared`: read `findPreparedIn(tx, key, userId)`; if a row for this exact key exists,
require `own.kind === 'bet'` and `own.canonical === canonical` (`conflictSemantics()` otherwise) and
return `{ prepared: true }` without drawing or inserting again. No shared-journal/P2002 mapping was added.

Targeted command and result (single filter, no other tests, no retypecheck):

```text
jest --runInBand test/book-of-ra-classic.wallet-replay-recovery.spec.ts -t "collapses two concurrent identical requests"
exit 0 - Tests: 7 skipped, 1 passed, 8 total
```

The test now drives the interleaving deterministically with the existing `afterPrepare` seam (held
outside the serialized transaction, so the advisory lock is never held by the gate): request 1 prepares
and is held; request 2 reaches its own-prepared path and settles, which is observed by the round row
appearing while request 1 is still held; the gate is then released. Asserts: both promises fulfilled
with byte-identical stored JSON, exactly one `CASINO_BET` of `-9`, wallet delta `-9`, one round, one
action row, zero remaining prepared rows for the key, `rngCalls` unchanged after preparation, and
`ledgerSum === balance`. Any unexpected rejection fails the test with its full stack.

## Not run / untouched

No RTP/MaxWin/Admin Math Control/bankroll/RBAC/browser work. No runtime, schema, evaluator or profile
edits. No TRUNCATE/reset/drop. Only `boc_classic_test` (127.0.0.1:55432, project gat-p0) was written;
one extra fixture user/admin pair plus its ledger, round, action and session rows remain there.
