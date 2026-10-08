# Integration handoff review

The integration branch contains the requested backend and UI cherry-picks in
order, ending at e204d7c. Source branch tips remain 831cbfc and 746146a.
All seven reference images match the accepted UI commit. Integration glue is
uncommitted; nothing has been merged or pushed.

## Independently checked

- Nine adapter/projection tests pass after the final repair.
- A real authenticated spin returned a grid-reveal event and no hidden gamble
  ladder. Wallet change matched one 100-unit wager plus the authoritative payout.
- Replaying that idempotency key returned the same round and unchanged balance.
- Recovery returned a snapshot with no replay events. The completed round has
  no active round ID, as expected. An initial review assertion incorrectly
  required the completed round ID to persist; a read-only follow-up confirmed
  ROUND_COMPLETE with no pending action. Active-feature recovery is not claimed
  from this check.
- Served HTML contains the ordered integration initializer and inert cabinet,
  with neither fixture meter writes nor demo-player recovery.
- PostgreSQL 55433, Redis 56381, backend 4274 and preview 4276 listen on loopback.
  The unrelated preview on 4275 remains untouched.
- The only tracked integration delta is the additive Book presentation view;
  no engine, math, wallet, ledger, migration or accepted UI source was edited.

## Validation reported by the worker

117 Book tests, 44 UI source tests and 42 focused backend tests passed. Backend
and UI builds passed. The original UI bundle is reproduced from source.

## Limits and corrections to the worker report

The final adapter now emits a scatter win event and an authoritative retrigger
feature-start event. The older paragraph in WORKER-REPORT.md saying neither is
available is stale. Initial Free Games intro is not emitted by liveEvents; the
feature snapshot/HUD remains available. This presentation gap is not accepted
as fully verified Free Games presentation.

There was no browser execution or capture. Live Free Games, retriggers,
five consecutive gamble attempts and active-feature refresh have not all been
observed through the running preview. Existing deterministic backend tests
cover these rules and recovery; they are not browser evidence and there is no
supported HTTP fixture switch for forcing them in the manual game. Per-round
GET lookup is unsupported (501); current-state recovery is supported. Buy/ante
controls are rejected because the accepted backend provides no such route.

Run in PowerShell from this worktree:

    node scripts/book-integration/setup.mjs
    node scripts/book-integration/start.mjs

Then open http://127.0.0.1:4276/?state=01-base. The configured local test player
signs in through normal authentication. Credentials are in ignored
.env.integration. The application uses book_playtest_test; destructive test
fixtures use the separate book_integration_test database.
