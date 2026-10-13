# A2 acceptance checkpoint

Status: READY FOR REVIEW (rescue complete); implementation uncommitted, not
self-accepted. One executor. The two remaining failures were test-harness
defects with no production change required: both are fixed and the whole
focused set is green again.

## Rescue result (2026-10-13)

- Root causes, both in `backend/test/security-game-session-revocation.integration.spec.ts`:
  - **A - administrator reset race timed out.** Order A constructed the reset as
    an inline `server().post(...).send(...)`. Supertest does not dispatch such a
    request until the returned Test is awaited, and the test awaited a *lock
    signal* instead, so the request never reached the server, the signal never
    fired and Jest timed out; the parked bet then finished at ~119.6 s when the
    `afterEach` safety net released it (visible in
    `logs/a2-harness-correction-validation.log`). Fix: dispatch via an `async`
    `resetPassword()` helper (and use it in both orders).
  - **B - duplicate race expected 200, observed 401.** The duplicate was started
    with no gate while the logout was free to commit first, so the duplicate's
    HTTP session validation legitimately observed a revoked session. The
    contract is now asserted for **both** deterministic orderings instead of
    betting on one interleaving:
    - *replay-first*: the logout is parked **before** its real account-row lock
      statement (`holdNextAttempt` wraps the real call and real SQL, no
      production bypass), so the duplicate is answered with the identical
      stored response (`200`, byte-equal body); the logout is then released and
      the retired credential is refused (`401`).
    - *revoke-first*: the duplicate is parked inside the real
      `GameCapabilityService.assertSession` (spied, delegating to the real
      method), the logout commits, and the same identical request is refused
      (`401`) rather than replayed.
  - Both orderings assert exactly one debit, no credit, one round and one action
    row per player, and a wallet equal to its ledger.
- Evidence: `--runTestsByPath test/security-game-session-revocation.integration.spec.ts -t "linearizes an administrator password reset with a paid action in both orders|keeps exactly one debit when two duplicate bets overlap a logout in both orders"`
  - **2/2 tests passed** (`logs/a2-rescue-pair.log`), then the full focused set
  (`security-game-session-revocation.integration` + `lucky-lady.max-win-scope` +
  `payout-distribution-runtime`, `--runInBand`) - **3 suites, 39/39 tests
  passed** (`logs/a2-rescue-full.log`) - and `npm run typecheck -w backend` -
  exit 0.
- Scope: hashed against the pre-edit backup manifest
  (`a2-rescue-backups/20261013-063612`, 33 paths), this rescue changed only the
  test spec (and then this documentation); production sources, the two
  migrations, the other specs and `docs/auth-session-revocation.md` are
  byte-identical to the backup.

## Validation history (2026-10-13)

1. Bounded 10-suite run (`logs/a2-correction-validation-1.log`): **9/10 suites,
   111/116 tests**; the 5 failures were all tests using the first `observeLocks`
   harness, which wrapped `app.get(PrismaService)` while the services use the
   per-module instances (`app.module.ts:36`, `casino.module.ts:71`). Product
   code was green in that run; the 10 non-race tests passed, including the
   cancelled-key reuse and revoked free-spin cases.
2. Harness correction: bound the observer to the service-injected clients,
   matched the account-row lock by target, parked operations only *after* the
   real lock statement resolved, signalled opponents at their lock statement,
   fixed the two dependent mocks (`lucky-lady.max-win-scope`,
   `payout-distribution-runtime`) and the rollback wording.
3. Bounded 3-suite run (`logs/a2-harness-correction-validation.log`): **2/3
   suites, 37/39 tests**; the two failures were the harness defects A and B
   above. Product code was not implicated.
4. Rescue pass (this execution): the pair of previously failing tests
   (**2/2**, `logs/a2-rescue-pair.log`) and then the whole focused set
   (**3 suites, 39/39**, `logs/a2-rescue-full.log`), with typecheck green.

## Resolved this execution

**Prepared-outcome deletion (the review blocker).** Revocation no longer deletes
`GamePreparedOutcome`. The row is retained and marked terminally cancelled
(`cancelledAt` / `cancelledReason`, additive migration
`20261013120000_game_prepared_outcome_cancellation`), so:

- the request key, canonical semantics and the already-drawn outcome bytes stay
  durable, and the key can never be prepared - therefore never redrawn - again;
- cancelled rows are excluded from reconciliation (no retry loop) and from the
  foreign-prepared gate (no blocking of unrelated actions);
- a later, fully authorized same-key request is refused inside the settlement
  transaction with zero money and zero draws; the same key with different
  semantics is still `IDEMPOTENCY_KEY_CONFLICT`;
- `cancelPrepared` takes the same per-player game lock and the same account row
  lock (`originStateIn`, `FOR UPDATE`) as a settlement, verifies owner and game
  on the row, and only marks when the stored origin is genuinely unbound,
  revoked, expired, disabled or unplayable. A still-valid origin is left
  pending, so crash recovery through a valid origin is unchanged.

Supersession is deliberately unchanged: a stale outcome is still dropped, which
the accepted `lucky-lady.integration` case "refuses a stored gamble whose round
state was superseded" depends on (same key, correctly gated fresh draw).

**Cancelled keys on every action path (review finding 1).** The rejection now
lives at the single shared idempotency read, `GameJournalService.findReplayIn`,
which every action path calls first. A committed action still returns its
stored response; a cancelled identity - scoped to its own owner and game - is
refused there with the same canonical-consistency rule, so a cancelled key can
never become a new bet, gamble, free spin or collect, never reaches the RNG,
wallet, round or action tables, and can never ignore changed semantics on an
alternate path.

**Coordination without sleeps (review finding 2).** The new spec no longer
polls `pg_stat_activity` with `setTimeout`; it orders operations with explicit
promises resolved by Jest wrappers around the app's *real* `$transaction` and
the real transaction-client lock statements. The wrappers always delegate to
the real implementation, so every statement still runs against PostgreSQL and
nothing is faked or bypassed. The accepted auth suite's own polling helper was
left untouched.

**Review questions answered.**

- Changed semantics on a cancelled key remain `IDEMPOTENCY_KEY_CONFLICT`
  (checked before the cancellation branch in both adapters).
- A cancelled key takes no RNG draw: the new spec counts adapter draws and
  asserts the counter is unchanged across the refused same-key retry.
- Cancellation holds the account row lock exactly as a settlement does.
- Read/reconcile paths: settlement is always authorized by the *stored origin*
  session through the same guard, and the caller's own session is asserted at
  the HTTP boundary before any adapter code runs, so a revoked caller cannot
  trigger settlement; a valid origin belonging to the same user is the
  pre-existing, accepted recovery semantic and settles exactly once.

## Evidence

- `npm run typecheck -w backend` - exit 0, after the rescue edits.
- `npx prisma validate` - "The schema at backend/prisma/schema.prisma is valid";
  `npx prisma migrate deploy` reports no pending migrations on the task's own
  `security_game_sessions_test` database.
- Rescue (this execution): the two previously failing tests **2/2**
  (`logs/a2-rescue-pair.log`), then the full focused set - new spec +
  `lucky-lady.max-win-scope` + `payout-distribution-runtime` - **3 suites,
  39/39 tests** (`logs/a2-rescue-full.log`).
- Earlier accepted evidence, kept for context: 10-suite run, **111/111**
  (`logs/a2-completion-validation-1.log`).

## Remaining (not blockers, but stated honestly)

1. **Prior transaction-start timeout - unverified resource hypothesis, not
   silently retried.**
   `lucky-lady-payout-panel.integration` failed once with
   `Transaction API error: Unable to start a transaction in the given time.`
   at `points.adminGrant`. The working hypothesis - explicitly **unverified** -
   is resource pressure rather than test isolation: that suite runs with
   `MATH_CONTROL_INPROCESS=1` and a single `payout.generate` taking ~121 s,
   while `adminGrant` uses the app's Prisma pool with the default 2 s
   `maxWait`. Observable support: no A2-guarded gameplay had run in that file
   before the failure (its only gameplay line comes after), the failing
   statement is untouched by this change, and an earlier isolated re-run of
   that single test passed. That is evidence consistent with the hypothesis,
   not proof; it was not re-run in this bounded execution, and CI or a
   dedicated isolated run must decide it.
2. **Coverage gap in this execution.** The math-control-family suites touched
   only for session-binding fixtures (`book-of-ra-classic.default-integration`,
   `default-activate-cycle`, `shared-history-rollback`,
   `math-control.integration`, `game-math-control.integration`,
   `lucky-lady-payout-panel`) were green in the previous execution and were not
   re-run here, per the bounded budget; their edits are unchanged since then.
   The cancellation path they could reach is covered directly by the new spec,
   and the prepared-outcome lifecycle by `wallet-replay-recovery` and
   `lucky-lady.integration`.
3. **Stack dependency.** Branch `security/game-session-revocation` is based on
   A1 `bbd04a1` (`security/remove-password-vault`, PR19 open). Any PR must be
   stacked on that branch, not on `project/current-snapshot`.
4. **Rollout/rollback.** Migrate before serving the updated backend. There is
   no supported rollback to a column-unaware backend: the cancellation markers
   are durable tombstones, and an unaware reader deletes a prepared row on
   refusal and accepts legacy `NULL` credentials, which re-enables exactly the
   states this milestone removes. Rollback means stopping gameplay, draining
   writers, then **keeping the additive columns and their markers and
   forward-fixing the new backend** - not dropping the columns and not
   restarting the pre-milestone backend. Full wording in
   `docs/SECURITY-GAME-SESSION-REVOCATION-A2.md`.
