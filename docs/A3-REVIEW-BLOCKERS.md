# A3 acceptance checkpoint

Status: READY FOR REVIEW; implementation uncommitted, not self-accepted. No
commit, push or PR yet. One executor; the bounded correction was completed and
the affected spec re-run once.

## Blocker resolved: one-stake concurrent placement

The uncovered interleaving was: two identical requests, both missing the
duplicate lookup, a wallet funded with exactly one stake, the loser's
conditional debit waiting for the winner and then updating zero rows, so it
threw `INSUFFICIENT_VIRTUAL_BALANCE` before the unique index could ever answer
it.

The loser is now recovered through the same validated re-read as every other
concurrent-placement outcome (`isConcurrentPlacementAbort`: `P2002`, `P2034` and
`INSUFFICIENT_VIRTUAL_BALANCE` in both Nest response shapes), and with no stored
row the original failure stands. Deterministic proof in
`backend/test/sports-idempotency-ownership.integration.spec.ts`:

- the barrier now lives inside the real `bet.findUnique`: each transaction
  performs the real lookup and is held only when the result is `null`, until
  both racers have observed `null` (`nullLookups() === 2`) and are released
  together - so both provably miss the duplicate lookup;
- in the one-stake case the observed `wallet.updateMany` counts are `[0, 1]`,
  i.e. the loser really did lose the balance race with zero rows updated, and
  the real object-form `INSUFFICIENT_VIRTUAL_BALANCE` recovery answered it;
- both callers receive the same complete stored bet (deep-equal projection: id,
  owner, stake, payout, odds, fingerprint and legs), exactly one bet, one leg
  and one ledger row exist, the balance is `0`, and the wallet equals the sum of
  its ledger.

## Other review findings closed

- **Foreign owner through the transaction lookup.** A direct test now misses the
  pre-check for the attacker and proves the real in-transaction lookup refuses
  the foreign row with the same generic conflict, no debit and no ledger row.
- **Legacy rows fail closed.** `Bet.idempotencyCanonicalHash IS NULL` is
  unprovable, so every retry - including a byte-identical one - gets the generic
  conflict. The row is never replayed, rewritten or deleted. A client that hits
  that conflict must **retrieve and inspect the already-stored bet through the
  authorized history and retrieval paths** - it must never automatically submit
  the same intent under a new key, which would place a second bet; a new key is
  only for a separately intended new bet. The rollout order (migration first, no
  fingerprint backfill, mixed-writer limitation) and the full compatibility
  impact are documented in `docs/sports-idempotency-ownership.md`.
- **Narrow helper cannot replay a wide bet.** `PointsService.placeSportsBet`
  replays only its own rows: same owner, exact stake and payout, no fingerprint
  and no persisted legs; a full-selection bet is refused even when owner, stake
  and payout match. Its Serializable aborts are recovered through the same
  validated re-read.
- **Classifier shape.** `new ConflictException('INSUFFICIENT_VIRTUAL_BALANCE')`
  returns `{ message, error, statusCode }` from Nest, not the raw string; the
  predicate now recognises the `code`, the `message` and the raw string. The
  real helper race recorded exactly one abort, and the string-message branch is
  additionally pinned by an injected-error test (the race itself is allowed to
  surface either a zero-row debit or a serialization conflict, because
  Serializable decides).
- **Documentation accuracy.** The conflict body no longer claims to hide key
  existence: it discloses no owner, bet id, balance, legs or raw Prisma detail,
  but the conflict itself reveals that the key has been used, and probing one
  key at a time stays observable. The old pre-check is described as it was: it
  *did* refuse foreign owners and instead answered any same-owner reuse without
  comparing the request.

## Evidence

- `npm run typecheck -w backend` - exit 0 (after the final edits).
- `npx prisma validate` - "The schema at backend/prisma/schema.prisma is valid";
  `npx prisma migrate deploy` - no pending migrations (own database
  `security_sports_idempotency_test`).
- `--runInBand --runTestsByPath test/sports-idempotency-ownership.integration.spec.ts`
  - **1 suite, 18/18 tests passed** (`logs/a3-validation-2.log`).
- Earlier bounded run of the A3 spec plus the affected neighbouring suites
  (`bet-placement.integration`, `points.integration`,
  `sports-operations.integration`) - **4 suites, 44/44 tests passed**
  (`logs/a3-validation-1.log`). It predates the two-line classifier shape fix,
  which the A3 spec now pins directly; per the bounded instruction the three
  neighbouring suites were not re-run.

## Known limits

1. Key-existence probing remains observable by design (documented above).
2. Legacy placement retries fail closed; on that conflict the caller retrieves
   the already-stored bet from authorized history instead of resubmitting the
   same intent under a new key, and uses a new key only for a separately
   intended new bet.
3. The real `placeSportsBet` race asserts the outcome, not which of the two
   legitimate Serializable failures occurred; each classifier input is pinned
   deterministically by an injected-error test.
