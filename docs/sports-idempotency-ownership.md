# Sports bet idempotency ownership

`BetsService.place` treats `idempotencyKey` as the identity of a *placement
request*, not merely of a bet row. A retry may only ever be answered with the
stored bet when the caller owns it and the request is provably the same one.

## The defect this closes

The same key was validated in three places with three different rules:

- the pre-check *did* refuse a foreign owner, but it answered any reuse of the
  key by the same owner with the stored bet without comparing the request at
  all, so a changed payload silently replayed the earlier bet;
- the in-transaction lookup returned whatever row it found **without checking
  the owner**, so a request that raced past the pre-check could read a foreign
  bet - that path was the real disclosure;
- the unique-violation (`P2002`) fallback checked the owner but re-threw the raw
  Prisma error for a cross-owner race, leaking the constraint that fired;
- and a concurrent identical placement funded with exactly one stake could fail
  with `INSUFFICIENT_VIRTUAL_BALANCE` before it ever reached the unique index,
  so no replay path answered it at all.

No path compared the request body, so the same key with a different stake,
price or selection set replayed the earlier bet instead of failing.

## The contract

One validator, `resolveReplay`, is used by every lookup and recovery path. It
answers a retry with the stored bet only when:

1. `stored.userId === callerUserId`, and
2. the stored request carries a fingerprint that is provably identical to the
   incoming one.

Anything else throws the same generic `409 { code: "IDEMPOTENCY_KEY_CONFLICT" }`
with no bet id, owner, balance, legs or raw Prisma detail. The response is
byte-identical whether the owner differs, the payload changed, or the row is an
unprovable legacy row, so it never discloses *whose* key it is or anything about
the stored bet.

It does **not** hide that the key has been used: the conflict itself says so,
and a caller who can submit a placement can always probe one key at a time.
Key-existence probing therefore remains observable by design; only the owner and
the bet data stay private.

The compared request ("canonical placement") is:

```text
{ type, stake, selections: [ { eventId, sportKey, marketKey, selectionKey, displayedOdds } ] }
```

- `stake` is the exact integer stake.
- `displayedOdds` records whether the caller supplied a price and which one. An
  absent price is stored and compared as `null` and is deliberately **not**
  equal to a supplied one, because echoing the price is part of the request.
  Values are normalized with `Decimal.toFixed()` so `2.15`, `2.1500` and
  `2.15000000` are the same request while a genuinely different number is not.
- Selections are compared as a set keyed by `(eventId, sportKey, marketKey,
  selectionKey)`. That matches the existing placement contract, which already
  rejects duplicate logical selections and whose accumulated odds and persisted
  legs are order-independent. Reordering the same selections is the same
  request; changing the set, any leg field, the stake, the type, or a supplied
  price is a different request and therefore a conflict. Altered selections are
  never silently permitted.

## Persistence and legacy rows

The stored `Bet` and its legs cannot prove the original request: a caller that
omitted `displayedOdds` and one that echoed the accepted price produce identical
rows. `Bet.idempotencyCanonicalHash` (nullable `TEXT`, migration
`20261012130000_bet_idempotency_canonical_hash`) therefore persists a SHA-256
fingerprint of the canonical placement on every new bet.

- **New rows** (fingerprint present) are replayed only on an exact fingerprint
  match. This is the authoritative comparison; it is not reconstructed from
  legs.
- **Legacy rows** (fingerprint `NULL`, written before the migration) are
  **unprovable**: the migration is additive with no default and no backfill, and
  nothing in the stored row can reconstruct the original request. Every retry
  against such a key therefore fails closed with the same generic conflict -
  including a byte-identical one - and the row is never replayed, rewritten or
  deleted.

**Rollout order.** Apply the additive migration before the updated sports
backend serves traffic; the new code reads a column that must already exist, and
the `ALTER TABLE ... ADD COLUMN` is safe to run while the previous backend keeps
serving. Never fabricate or backfill fingerprints: a guessed fingerprint would
turn an unprovable row into a replayable one and could hand a caller a bet it
never placed. Until every writer runs the updated code, rows written by an old
writer keep `NULL` and stay subject to the legacy limitation below, so a mixed
deployment is expected to produce legacy conflicts for the keys it creates.

Compatibility impact: after this change a client that retries a placement whose
key was first used before the migration gets a conflict instead of a replay.
That is not an instruction to resubmit: the intent already has a stored bet, so
the client must **retrieve and inspect that bet through the authorized history
and retrieval paths** instead of automatically submitting the same intent under
a new key - a new key means a *new, separately intended* bet and would place a
second one. This is the deliberate cost of never fabricating a replay from data
that cannot prove the original request, and it applies only to keys whose row
predates the migration (or was written by a pre-migration writer during the
rollout).

## Concurrency

The transaction keeps its Read Committed conditional wallet debit
(`UPDATE ... WHERE balance >= stake`) and the unique index on `idempotencyKey`.
When two requests with the same key race, exactly one bet, one debit and one
ledger row are written, and the loser's transaction rolls back completely. The
loser can fail in one of three ways, and all three are now recovered the same
way:

- `P2002` - the unique index rejected its insert;
- `INSUFFICIENT_VIRTUAL_BALANCE` - its conditional wallet debit waited for the
  winner, re-read the committed balance and updated zero rows (the one-stake
  case, which never reaches the unique index);
- `P2034` - a serializable abort or deadlock.

`isConcurrentPlacementAbort` recognises those outcomes (including Nest's
normalisation of a string message into `{ message, error, statusCode }`, which
is the shape `PointsService.placeSportsBet` produces). The loser then re-reads
the key and runs the same validator, so it either returns the owner's stored bet
or throws the generic conflict; with no stored row the original failure stands,
and a `P2002` without a row is reported as the generic conflict rather than a raw
constraint error. No global lock, retry loop or architecture change is
introduced.

The concurrency tests do not rely on timing. A Prisma stand-in wraps the real
transaction client's `bet.findUnique`: it performs the real lookup and, when the
result is `null`, parks that transaction until **both** racers have observed
`null`, then releases them together. Wallets, debits and every other statement
stay real, and `wallet.updateMany` is only observed, never altered.

## Legacy `PointsService.placeSportsBet`

`PointsService.placeSportsBet` is a legacy helper with no production callers
(only `backend/test/points.integration.spec.ts` exercises it); the live
placement path is `BetsService.place`. It previously did `if (existing) return
existing` with no ownership or payload check, so it was an exposed bypass. It
now replays only when the stored bet belongs to the same user, has the exact same
`stake` and `potentialPayout`, carries no canonical fingerprint and has **no
persisted legs**. The last two conditions distinguish its own narrower rows from
anything the full placement path wrote: a full-selection bet must never be
validated by a helper that never saw its selections. Everything else throws the
same generic conflict, and the helper's serialization/insufficient-balance
outcomes are recovered through the same validated re-read. Its debit, credit and
audit rules are unchanged.

## Validation

Against the isolated `security_sports_idempotency_test` database on the shared
local PostgreSQL container:

- `backend/test/sports-idempotency-ownership.integration.spec.ts`, 18 tests -
  the three lookup paths (pre-check, in-transaction, `P2002`), a foreign owner
  found by the in-transaction lookup after a missed pre-check, identical
  same-owner replay without a fresh provider lookup, changed-payload conflict,
  the lookup-level concurrency barrier for identical / changed-payload /
  cross-owner races, the one-stake race (both lookups observed `null`, the
  loser's debit updated zero rows, both answers deep-equal, one debit, wallet
  equal to its ledger), a real concurrent `placeSportsBet` race, injected
  `P2002`/`P2034`/insufficient-balance recoveries, the full-selection refusal
  and the fail-closed legacy policy.
- Neighbouring suites re-run unchanged: `bet-placement.integration`,
  `points.integration`, `sports-operations.integration` (4 suites, 44 tests
  together).
- `npm run typecheck -w backend` and `npx prisma validate` pass.

Exact runtime branches observed: in the one-stake `BetsService` race the losing
conditional debit returned `count = 0`, so the real object-form
`INSUFFICIENT_VIRTUAL_BALANCE` recovery path answered it; the real
`placeSportsBet` race recorded exactly one aborted transaction and both callers
resolved to the same stored row (Serializable may report that abort as either a
zero-row debit or a serialization conflict, so the test asserts the outcome);
the `P2034` and string-message insufficient paths are pinned deterministically
by the injected-error tests rather than claimed from the race. Logs:
`logs/a3-validation-1.log` (4 suites / 44 tests) and `logs/a3-validation-2.log`
(A3 spec / 18 tests).
