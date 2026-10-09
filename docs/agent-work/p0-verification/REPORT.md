# P0 verification: security / RBAC / payout

Scope: close the two blockers from the forensic review (stale Lucky Lady role test; no saved green run for the
payout-panel / snapshot / RBAC code). Verification plus minimal fixes only. No RTP math, UI, or buyer demo touched.

## Test database (isolated)

| | |
|---|---|
| Host / port | 127.0.0.1 : 55432 |
| Database | `toto_gat_test` (contains `_test`) |
| Compose project / container | `gat-p0` / `gat-p0-postgres-test` (+ `gat-p0-redis-test` on 56380) |
| Created for | this task only, own volume `gat-p0_gat_p0_pg` |
| Compose file | outside the repo (task scratchpad) |

The pre-existing `toto-postgres-test` container belongs to compose project `toto` at `C:\Users\Admin\Desktop\toto`
(another checkout) and was **not** started or modified. `fools_gold` on 5432 was never used. Every run went through a
guard that re-asserts host, port, `_test` name and compose project before executing. Migrations (all 17) were applied
to the empty test DB only. No credentials are stored in this report or the logs.

## Results

| Run | Result | Log |
|---|---|---|
| `lucky-lady.integration.spec.ts` | run 1: 28/29 (stale HTTP assertion); run 2: **29/29** | `evidence/lucky-lady-integration.txt` (+ `.run1-failed`) |
| payout panel + snapshot runtime + messages | run 1: 27/28 (real bug); run 2: **3 suites, 28/28** | `evidence/payout-panel-snapshot-messages.txt` (+ `.run1-failed`) |
| `hierarchical-rbac.integration.spec.ts` + `rbac-unit.spec.ts` | **2 suites, 21/21** | `evidence/rbac-integration-unit.txt` |
| `p0-pts-superadmin-security.integration.spec.ts` (new) | **9/9** | `evidence/pts-superadmin-disabled.txt` |

## Fixes

1. `backend/test/lucky-lady.integration.spec.ts` (tests only). Two stale assertions expected ADMIN launch to be
   refused. Replaced by: USER, ADMIN and SUPER_ADMIN may launch; a disabled account may not (refusal audited); each
   session binds its own owner; disabling an account after it holds a session stops that session at once.
2. `backend/src/casino/games/lucky-lady/payout/lucky-lady-payout.service.ts` (one line, a real bug). `resultFromRow`
   reported `active.mode = CUSTOM` for any non-DEFAULT row, so a ROLLBACK that landed on the default was reported
   as CUSTOM. The authoritative pointer was already correct; only the returned state was wrong, which would have
   made the admin panel show custom RTP as ON. A row with no candidate now reports DEFAULT.
3. `backend/test/p0-pts-superadmin-security.integration.spec.ts` (new). Covers gaps the existing suites left.

## What each required proof rests on

- DEFAULT / CUSTOM snapshot, DEFAULT-before-round, round-before-DEFAULT, old feature keeps originating policy, replay
  without redraw or re-debit, concurrent identical requests select once: `payout-distribution-runtime.spec.ts` and the
  panel spec (28/28).
- PTS: USER refused (grant and remove); ADMIN and SUPER_ADMIN adjust a USER; ledger rows carry type, amount, reason and
  acting admin; balance equals ledger sum; `UPDATE`/`DELETE` on `LedgerEntry` rejected by the append-only trigger;
  replay returns the same entry without a second credit; same key with changed amount, reason, target or type is
  refused; ADMIN refused against ADMIN and SUPER_ADMIN targets.
- Last SUPER_ADMIN: sole active account cannot be demoted or self-disabled; concurrent mutual demotions and mutual
  disables yield exactly one winner and exactly one active SUPER_ADMIN; a refused change leaves role, status and audit
  count unchanged.
- Disabled account: admin API, launch and PTS routes return 403 immediately on an existing token (status read from the
  database).
- IDOR / ownership: RBAC suite cross-player round test and Lucky Lady session-binding assertions pass.

## Limits of this evidence

- The Lucky Lady and RBAC suites ran before fix 2; fix 2 changes only the payout service's returned state, and the
  payout suites were re-run afterwards. A final all-suites pass has not been run.
- The concurrency proofs use two simultaneous operations, not a load test. Connection-pool pressure from the nested
  snapshot transaction is still unmeasured (P1).
- Jest `--verbose` per-test names are not captured by the log redirect; counts come from jest's summary.


---

# P1 addendum

All evidence is in `evidence/`. The earlier `logs/` directory was gitignored by the repo `logs/` rule, so it was moved.

## Fixes (backend)

| Item | Change |
|---|---|
| Disabled login | `AuthService.login` refuses a disabled account with 403 after the password is verified. A wrong password still gets the ordinary 401, so status is not disclosed. Audited as `LOGIN_FAILED` / `ACCOUNT_DISABLED`. |
| Disabled refresh | `rotateRefreshToken` re-reads `disabled` from the database in its transaction, revokes the token family and returns 403. `AuthorizationService.setDisabled` also revokes all of the target's refresh tokens in the same transaction. |
| Existing token | Unchanged and re-proven: `AccessGuard` reads `disabled` and role from the database on every request. |
| Rate limit | `UserAdminController` role and status routes consume `RATE_LIMITS.admin` (20/min per actor, scope `admin:users`) through the existing `RateLimitService`. |
| Audit semantics | Demotion is recorded as the new `ADMIN_ROLE_REVOKED`; promotion stays `ADMIN_ROLE_GRANTED`; status stays `ADMIN_USER_STATUS_CHANGED`. Historical rows are not rewritten. |
| Migration | One additive migration `20261006120000_audit_role_revoked` (enum value only). Applied to `toto_gat_test` only. **Not applied to the dev database `fools_gold`.** |
| Comment | Payout controller comment now states the `GAME_MATH_MANAGE` capability (ADMIN and SUPER_ADMIN). |

## Results

| Run | Result |
|---|---|
| `p1-auth-ratelimit-audit.integration.spec.ts` | run 1: 3/5 (my body assertion was wrong; the global filter sanitizes bodies); run 2: **5/5** |
| Final combined, final tree (8 suites) | **8 suites, 92/92** (`final-combined-p0-p1.txt`) |
| Backend `tsc --noEmit` | zero diagnostics |

The final combined run covers `lucky-lady.integration`, `lucky-lady-payout-panel.integration`, `payout-distribution-runtime`, `lucky-lady-payout-messages`, `hierarchical-rbac.integration`, `rbac-unit`, `p0-pts-superadmin-security.integration` and `p1-auth-ratelimit-audit.integration`.

Two existing specs were adjusted for the new rule: `hierarchical-rbac` now builds a stale access token for the disabled user (a disabled user can no longer log in), and the P0 spec counts `ADMIN_ROLE_REVOKED` for demotions.

## Concurrency measurement (concrete blocker)

`p1-snapshot-concurrency.integration.spec.ts` drives real concurrent NEW paid rounds, one per distinct user, against the isolated DB. It asserts integrity only and does NOT gate availability. Metrics: `evidence/p1-snapshot-concurrency-metrics.json`.

| Scenario | Pool | Concurrent rounds | Completed | Failed | Duration | Pool errors |
|---|---|---|---|---|---|---|
| baseline | 17 | 12 | 10 | 2 | 0.5 s | 0 (the 2 failures are a first-row `platformSettings.upsert` unique-constraint race) |
| above pool, policy flipping | 17 | 40 | 1 | 39 | 10.3 s | 39 |
| threshold probe, flipping | 5 | 12 | 1 | 11 | 10.1 s | 11 |

**Integrity held in every scenario:** zero mixed DEFAULT/CUSTOM snapshots, zero duplicate debits, zero duplicate action rows, at most one round per user, balance equals ledger sum for every wallet, no side effects from any failed round, and every replay returned a byte-identical response with no new ledger row.

**Availability fails once concurrent paid rounds reach the pool size.** Each round holds one pooled connection in its serialized transaction and then needs more from the same pool. The first call to fail is `casino-config.service.ts:224` (`platform()` -> `platformSettings.upsert`, reached from `assertPlayable` and config resolution). That is accepted pre-existing code and not part of this task's diff. The nested `activePayoutSnapshot` transaction adds one more nested acquisition on the same path. This is an availability limit, since failed rounds roll back cleanly, and not a correctness failure. No transaction or pool change was made, as instructed.

Not measured: whether removing only the snapshot's nested acquisition would change the threshold (the pre-existing `platform()` call fails first), and the effect of a larger `connection_limit`.


---

# Paid-round connection starvation: fixed

## Root cause

A NEW paid round holds one pooled connection for its whole `serialized` transaction. While holding it, the prepare phase asked the pool for more:

| Call inside the round transaction | Before | After |
|---|---|---|
| `configs.assertPlayable` -> `platform()` upsert | acquired another connection | reads through the round's tx client |
| `configs.assertPlayable` -> `effective()` / `ensure()` read | acquired another connection | reads through the round's tx client |
| `activePayoutSnapshot` (own RepeatableRead transaction) | acquired another connection | resolved **before** the round transaction opens |
| legacy `pinnedMath()` (no payout service) | acquired another connection | resolved **before** the round transaction opens |
| journal / rounds / wallet / `prepareOutcome` / settlement | tx client | tx client (unchanged) |

Nested pool acquisitions per paid round: **3 before, 0 after** (4 before on the legacy path). Once concurrent rounds reached the pool size, every connection was held by a round waiting for a second one, a real dependency cycle.

## Fix

- `casino-config.service.ts`: `assertPlayable(gameId, db?)` and `effective(gameId, db?)` accept a transaction client. With `db`, config and platform flags are read-only through it; an unseeded row reads as the baseline defaults, which is exactly what seeding produces. The pool path (all other games) is unchanged.
- `casino-config.service.ts`, platform settings race: `platform()` was `upsert` (read-then-insert), so concurrent first callers could both insert and one hit a unique violation. It is now `findUnique`, then one `INSERT ... ON CONFLICT DO NOTHING` on the primary key, then `findUniqueOrThrow`. No error is caught or hidden, and exactly one row can exist.
- `lucky-lady.adapter.ts`: `activePayoutSnapshot` and the legacy `pinnedMath` are resolved before the round transaction opens, and the round uses that value. The snapshot keeps its own RepeatableRead read, so isolation is not weakened. It is final before any draw and pinned on the round, and a request that turns out to be a replay discards it (nothing is pinned).
- Why not reuse the round's transaction for the snapshot: the round transaction is READ COMMITTED, so reading the snapshot through it would have weakened the coherent single-read guarantee. Resolving it first removes the nested acquisition and keeps the stronger isolation.
- No caching was added. Role, disabled status, balance, round state and the active policy are all still read from the database each time.

## Evidence

Before (`evidence/p1-concurrency-BEFORE-fix-*`): pool 17 / 12 rounds: 10 completed (2 first-row upsert races); pool 17 / 40: 1 completed, 39 pool timeouts; pool 5 / 12: 1 completed; **pool 1 / 3 rounds: 0 completed, all timed out after about 10 s**.

After (`evidence/p1-snapshot-concurrency-metrics.json`):

| Scenario | Pool | Rounds | Completed | Pool timeouts | Other errors | Duration |
|---|---|---|---|---|---|---|
| A | 17 | 12 | 12 | 0 | 0 | 0.5 s |
| B (policy flipping) | 17 | 40 | 40 | 0 | 0 | 1.3 s |
| C (policy flipping) | 5 | 12 | 12 | 0 | 0 | 0.6 s |
| D (proof) | 1 | 3 | 3 | 0 | 0 | 0.3 s |

Scenario D is the deterministic proof that the dependency cycle is gone, not just that capacity grew: with a single connection, any nested acquisition deadlocks until the pool timeout, and all three rounds completed in 0.3 s.

Integrity in every scenario: zero mixed DEFAULT/CUSTOM snapshots, zero duplicate debits, zero duplicate action rows, at most one round per user, balance equals ledger sum, no side effects from any failed request (none failed), and every replay byte-identical with no new ledger row.

Honest limit: the policy flipped 3 times in B and 2 times in C, but within each scenario all rounds landed on one side of the flip (B all CUSTOM, C all DEFAULT). Both coherent states were observed across the run and no mixture appeared, but a single scenario with rounds on both sides of a flip was not produced.

Regression after the fix: 8 suites, 92/92 (`evidence/final-combined-after-pool-fix.txt`). Backend `tsc --noEmit`: zero diagnostics.

## Note on the concurrency spec

`p1-snapshot-concurrency.integration.spec.ts` is now a real availability + integrity gate (all four scenarios must complete with zero errors). It still takes roughly 3 minutes because it generates one real candidate, so keep it out of the default quick suite or run it explicitly.


---

# Running the concurrency regression gate

`backend/test/p1-snapshot-concurrency.integration.spec.ts` is the regression gate for paid-round connection use. It runs four scenarios (pool 17 x 12 rounds, pool 17 x 40 rounds with policy flipping, pool 5 x 12 rounds with flipping, and a pool 1 x 3 rounds proof) and requires every round to complete with zero pool timeouts while integrity holds. It takes about 3 minutes because it generates one real candidate.

Run it explicitly, from `backend/`, with `DATABASE_URL` pointing at an isolated `*_test` database (the test script refuses any other name) and `REDIS_URL` at the matching test Redis:

```
npm run test -- test/p1-snapshot-concurrency.integration.spec.ts --verbose
```

It truncates tables, so never point it at a development database. Metrics are written to `docs/agent-work/p0-verification/evidence/p1-snapshot-concurrency-metrics.json`.

Default-suite note: the repo Jest config (`roots: test/`) collects every `test/*.spec.ts`, and it already includes other long integration gates (the payout panel suite alone takes about 11 minutes), so this spec runs in a full `npm test` like them. For a quick loop, run individual files with `npm run test -- <path>`. The Jest config was deliberately not changed.
