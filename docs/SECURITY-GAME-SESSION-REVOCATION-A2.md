# Game session revocation (milestone A2)

**Stack dependency.** This work is stacked on `security/remove-password-vault`
(A1, PR19). It targets that branch and is not independently mergeable into
`project/current-snapshot`; the shared `security-game-session-revocation`
worktree is based on A1's HEAD so the two security changes are reviewed
together.

Every game credential - the one-time launch capability and the bound game
session - is now stamped with the `User.authVersion` it was minted under
(`GameLaunchCapability.authVersion`, `GameSession.authVersion`). All-devices
logout, an administrator password reset, a self password change and an account
disable already move that counter; the game layer now observes it, so a sign-out
or a password change retires what that account could still play with.

## What the pieces do

- `AccessGuard` publishes the exact `authVersion` it verified on
  `request.actor`, and `GameGatewayBase.issueLaunch` forwards it as the launch
  proof. `GameCapabilityService.issueLaunch` re-checks that proof under the
  account row lock, so a logout that commits between the guard and the mint is
  observed instead of raced past (a stale proof fails with
  `SESSION_PROOF_STALE`).
- A minted capability stores the account version it was bound to
  (`authVersion`); the raw opaque token is still returned once and only its
  SHA-256 hash is stored.
- `GameCapabilityService.exchangeLaunch` is one transaction: it locks the
  account row first, then re-reads the ticket, checks scope, expiry,
  consumption and its bound version, consumes it with a conditional update and
  mints the session that carries the same version. Consumption and session
  creation commit together, so a failed exchange leaves no partial state and
  two simultaneous exchanges can never both mint a session.
- `GameCapabilityService.assertSession` keeps the HTTP-level checks (game
  binding, revocation, expiry, role, disabled) and additionally refuses a
  session whose bound version no longer matches the account.
- `GameJournalService.serialized` now takes the bound session as an explicit
  trust value and runs `GameCapabilityService.assertActionAllowed` inside the
  transaction that will move the money, after the per-player game advisory lock
  and **before** any wallet row is locked. The guard locks the account row and
  re-reads the session, the account status and the account version under it.
  There is no variant of `serialized` without a session, so no adapter can
  reach a settlement unguarded.
- `revokeGameCredentials` (`src/auth/game-session-revocation.ts`) marks the
  user's still-active game sessions `revokedAt` inside the caller's
  transaction. Logout, `setPassword`, `changeOwnPassword` and `setDisabled`
  call it at the same commit that bumps `authVersion`; disabling also bumps the
  version (still inside the serializable transaction that owns the
  last-SUPER_ADMIN guard, so RBAC and the protected-account rule are unchanged).
  Launch capabilities need no row write to die: their bound version no longer
  matches, and they are never deleted.

## Linearization

One gameplay action and one revocation of the same account serialize on the
account row (`SELECT "id" FROM "User" ... FOR UPDATE`), taken before the wallet
row by gameplay and taken by the auth flows directly:

- action takes the account row and commits first -> a valid settlement; a
  revocation that follows retires the session afterwards, and the committed
  round, ledger rows and cached response stay durable;
- logout / password change / disable takes the account row and commits first ->
  the action re-reads the revoked session or the moved version inside its own
  transaction and is refused before any debit;
- overlapping requests are serialized per user only; there is no global lock.

The account lock is taken before the wallet lock, matching the existing wallet
transaction, so a gameplay transaction cannot deadlock with a logout or with
another game settling the same wallet.

A prepared outcome that has not settled when the revocation commits is refused
by the same guard and then **terminally cancelled, not deleted**
(`GamePreparedOutcome.cancelledAt` / `cancelledReason`). The row keeps its
request key, canonical semantics and the outcome that was already drawn, so:

- the key can never be prepared again, and therefore can never be redrawn;
- the terminal row is excluded from reconciliation (no retry loop) and from the
  foreign-prepared gate (it never blocks a new, independent action);
- a later, fully authorized request that reuses that key is refused before any
  draw or money movement, by a check inside the settlement transaction
  (`OUTCOME_CANCELLED`), while the same key with different semantics is still
  the ordinary `IDEMPOTENCY_KEY_CONFLICT`.

`cancelPrepared` runs in its own transaction under the per-player game lock and
brings the same guard as a settlement: it verifies the row belongs to this
owner and game, re-reads the account row under `FOR UPDATE` and only marks the
row when the stored origin session is genuinely unbound, revoked, expired,
disabled or otherwise unplayable. A row whose origin is still valid is left
pending, so crash recovery through a valid origin keeps working; a row that
belongs to someone else is never touched. There is no caller-supplied trust
flag anywhere in the shared layer, and no money is moved, refunded or redrawn
by a cancellation.

The refusal itself lives at the single shared idempotency read,
`GameJournalService.findReplayIn`, which every action path calls first (paid
round, gamble, free spin, collect). A committed action still returns its stored
response; a cancelled identity is refused there - scoped to its own owner and
game, with the same canonical-consistency rule as a committed action - so a
cancelled key can never be re-used as a new action on any path, never reaches
the RNG, wallet, round or action tables, and never silently changes semantics.

Supersession is unchanged: an outcome that a newer round state made stale is
still dropped (`discardPrepared`), which is the existing accepted behaviour and
is what lets the same key be answered again with a correctly gated draw.

## Migration and legacy credentials

Two additive migrations ship together, both safe to apply rolling forward:

- `20261012140000_game_session_revocation` adds the two nullable `authVersion`
  columns and then invalidates every pre-existing credential (launch
  capabilities are marked consumed, sessions are marked revoked);
- `20261013120000_game_prepared_outcome_cancellation` adds the nullable
  `cancelledAt` / `cancelledReason` columns to `GamePreparedOutcome`
  (`NULL` = still pending, so existing rows keep settling exactly as before).

Nothing is deleted or edited in the financial tables.

**Rollout and rollback.** Apply both migrations *before* the updated backend is
served; the new code reads columns that must already exist, and the add-column
statements are additive and safe to run while the previous backend is still
serving reads.

There is deliberately no supported live rollback to a backend that does not
know these columns. The cancellation markers are durable tombstones: dropping
`cancelledAt`/`cancelledReason` - or reverting to the older readers, which
delete a prepared row when a session is refused - would let a key that was
already drawn be prepared and drawn again, and would treat legacy `NULL`
credentials as usable again. Those are the exact states this milestone exists
to prevent, so marker loss is a real loss of revocation state, not a neutral
cleanup.

Rollback therefore means stopping gameplay and draining the old writers, then
**keeping the additive columns and their markers in place and forward-fixing
the new backend**. Dropping the columns is not a recovery step: it destroys the
tombstones permanently, so it must not be recommended, and it must not be used
to make an older backend runnable again.

Mixed-version limits: a backend without this change still accepts legacy
`NULL`-version credentials and still deletes a prepared row on refusal. Running
the pre-milestone backend against the migrated schema is therefore unsafe even
after a drain - it must not be restarted; the only supported way back is the
forward fix above.

Rows that predate the migration keep `authVersion = NULL`; every check compares
the bound version and refuses `NULL`, so an unbound credential fails closed
even if it was not touched by the backfill. Deployment order is therefore
ordinary: apply the migration, then serve the new code. A client holding a
legacy game session or launch link has to launch again, which is the intended
fail-closed behaviour; platform access tokens and refresh tokens are unaffected
by this migration.

## Validation

Commands run for the prepared-cancellation correction (all against the
dedicated `security_game_sessions_test` database on the local PostgreSQL 16
container and a dedicated Redis database):

- `npm run typecheck -w backend` (`tsc --noEmit`) - exit 0.
- `npx prisma validate` - "The schema at backend/prisma/schema.prisma is valid".
- `npx prisma migrate deploy` + `migrate status` - both migrations applied,
  "Database schema is up to date!".
- One bounded, sequential Jest invocation (`--runInBand --runTestsByPath`,
  ten suites, `logs/a2-completion-validation-1.log`): **10/10 suites,
  111/111 tests passed**. Suites: `security-game-session-revocation.integration`
  (new), `book-of-ra-classic.launch-acceptance`,
  `book-of-ra-classic.wallet-replay-recovery`, `book-of-ra-classic.integration`,
  `book-of-ra-classic.concurrent-bet-race` (accepted P2002 reuse branch),
  `game-adapter-template.integration`, `lucky-lady.integration`,
  `auth-session-revocation`, `user-accounts`, `hierarchical-rbac`.

The new spec's fifteen tests cover the accepted matrix: all-devices logout (session
and pending ticket), own password change, administrator reset (administrator's
own session untouched), disable then re-enable, fresh login/session, expired /
revoked / cross-game / cross-player sessions, consumed tickets, and four
lock-ordered races driven by explicit latches and by promises over the real
transaction and lock statements (Jest wrapping the real Prisma calls - never a
sleep, a poll or a fake authorization):

- action wins the account lock over a queued logout - exactly one debit, wallet
  equals ledger, committed round durable, stale replay refused;
- revocation wins - zero money, zero round, and the key terminally cancelled
  with its drawn bytes retained, then refused on a later authorized same-key
  request with **no new draw** (`rngDraws` unchanged) and no financial
  mutation, while a new key still plays;
- launch exchange against logout in both orders - exchange-first mints a session
  the queued logout immediately retires, logout-first mints nothing at all;
- disable wins the account lock - `ACCOUNT_DISABLED` cancellation, zero money,
  and the account is playable again only through a fresh session;
- the same two orderings for an administrator password reset, and the
  action-first disable;
- two duplicate bets overlapping a logout, asserted in **both** deterministic
  orderings rather than one interleaving: while the logout is parked before its
  real account-row lock statement (`holdNextAttempt`, delegating the real SQL)
  the duplicate is answered with the byte-equal stored response (200) and the
  credential is refused only after the logout commits; when the duplicate is
  parked inside the real `assertSession` call the logout commits first and the
  identical request is refused (401). Both orderings keep one debit, no credit,
  one round and one action row per player, with the wallet equal to its ledger;
- a cancelled key reused on the free-spin path (refused, zero draws, zero
  actions, zero money) and a revoked free-spin continuation (401 with the
  round's private state, actions and ledger unchanged).

Refresh/MFA behaviour is unchanged and evidenced by the untouched
`auth-session-revocation` suite in the same run (16 tests: refresh rotation,
family reuse detection, MFA challenge binding, the refresh/logout races).

Rescue pass (2026-10-13, test-harness only): the two previously failing tests
were fixed as described in `docs/A2-REVIEW-BLOCKERS.md` and re-run
`--testNamePattern`-selected - **2/2 passed** - followed by the full focused set
(this spec + `lucky-lady.max-win-scope` + `payout-distribution-runtime`,
`--runInBand`) - **3 suites, 39/39 passed** - and `npm run typecheck -w backend`
(exit 0). Raw logs: `logs/a2-rescue-pair.log`, `logs/a2-rescue-full.log`,
`logs/a2-completion-validation-1.log` (all gitignored).

PR25 CI then failed on `backend/test/p1-snapshot-concurrency.integration.spec.ts`
because that suite drove the real adapter with a placeholder session id and no
stored session, which this milestone's in-transaction guard correctly refuses
("Game session required."). It was fixed in the harness only - one bound
`GameSession` row per player - and re-run together with this spec and
`auth-session-revocation`: **5 suites, 59/59 tests passed**, with the suite's own
metrics showing `otherErrors: 0`, every round completed, no duplicate debit, no
mixed snapshot, no ledger mismatch and no new ledger row on replay
(`logs/a2-ci-fix-validation.log`). See `docs/A2-REVIEW-BLOCKERS.md`.
