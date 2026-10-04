# Game Math Control - implementation report

## Final Astra acceptance ? backend/domain foundation

**ACCEPT.** The reusable game adapter and math-control candidate passed final review with one bounded correction (native error mapping stays game-specific; fixture accounting excludes funding from casino-only deltas and also reconciles the complete ledger).

- Backend/frontend TypeScript: zero diagnostics; backend build passes.
- Full backend suite run once: 36 suites, 671 tests; two funding-fixture assertions failed and were corrected.
- Post-correction affected/focused checks: 9 suites, 147 tests, zero failures. Combined unchanged/full plus focused evidence covers 36 suites / 672 distinct passing tests, including the new error-isolation assertion. No second full-suite run.
- Original Lucky Lady browser harness run once: 92 checks, zero failures; stable 15/15 board, wallet/ledger, features/retrigger, gamble, recovery, IDOR and zero unexpected outbound requests.
- All 185 client blobs and the accepted manifest hash match. The native evaluator/rules and golden RTP50 remain byte-identical to e62e747.
- Saved generator candidates remain reproducible. 20x and 50x are explicit proved supports; no calibration rerun. RTP70 volatile remains statistically compatible with expectation (z=-1.21).
- No production profile/policy activation or default change. Test-only activation fixtures ran in a newly created disposable database. Admin UI draft and temporary root hash snapshots remain outside the accepted commit.

See [final acceptance report](../game-integration-template/REPORT.md), [machine evidence](../game-integration-template/acceptance.json), and [generator closure](generated/lucky-lady/CLOSURE.md). This accepts the foundation for later Admin UI work, not the pre-existing UI draft, deployment, or activation wiring for offline generated payout policies.

---

## Historical implementation record

The following describes the earlier worker candidate and its then-current decisions. Its ?ready for review? and whole-round/gamble-decision notes are historical; use the current RESOLVED_SPIN contract and the final acceptance report for current scope and limitations. Historical evidence files retain their own scopes/statuses.


Worker: DeepSeek V4.1 Flash. Branch: `integration/game-adapter-template`, HEAD `e62e747`.
Pre-task baseline snapshot: `C:/Users/Admin/orca/research/game-math-control-baseline`.
Status: **ready for Astra review. Not self-accepted. No commit, no push, no merge, no deployment.**

---

## 1. What this adds

A reusable, shared Game Math Control plane for casino adapters, plus Lucky Lady's
own mathematics adapter. The shared core owns policy validation, immutable
artifact identity, validation evidence, ADMIN authorization, auditing and the
durable per-game activation pointer. The game owns reachable outcome classes,
profile generation, exact evaluation and protocol mapping.

Added (new files):

```
backend/src/casino/platform/math-control/
  math-control.types.ts        policy, artifact, evidence, adapter interface
  math-control.policy.ts       bounded whitelist validation + presets (defaults only)
  math-control.rational.ts     exact rational EV (no floating-point money)
  math-control.analytics.ts    quantiles (R-7), payout bins, canonical hashing
  math-control.bankroll.ts     complete-session simulator + cohort report
  math-control.random.ts       independent deterministic simulation streams
  math-control.registry.ts     gameId -> adapter, 404 for anything else
  math-control.service.ts      generate / validate / activate / activeProfile
  math-control.controller.ts   ADMIN-only HTTP surface
  math-control.dto.ts          transport whitelist (identity fields rejected)

backend/src/casino/games/lucky-lady/
  lucky-lady.exact.ts          exact enumeration over reachable boards (the engine's own evaluate)
  lucky-lady.math-adapter.ts   generateProfile / validateProfile / sessionSource

backend/prisma/migrations/20261001120000_game_math_control/migration.sql
backend/scripts/math-control-evidence.mjs      reproducible evidence run
backend/test/game-math-control.spec.ts         pure control-plane tests (no database)
backend/test/game-math-control.integration.spec.ts   ADMIN/lifecycle/hash tests (PostgreSQL + Redis)
frontend/app/admin/casino/math/page.tsx        Game Math Control admin page
frontend/lib/math-control.ts                   admin client types + helpers

artifacts/math-validation/lucky-lady/...                     machine evidence
docs/agent-work/game-math-profiles/reports/lucky-lady/...    human bankroll reports
```

Modified, and why:

| File | Change |
| --- | --- |
| `backend/prisma/schema.prisma` | `GameMathProfile`, `GameMathProfileValidation`, `GameActiveMathProfile`; three additive `AuditAction` values |
| `backend/src/casino/casino.module.ts` | wires the registry, service, controller and Lucky Lady math adapter |
| `backend/src/casino/games/lucky-lady/lucky-lady.math.ts` | `EngineProfilePayload`; `generateCompleteRound` accepts the round's pinned weighting; `nativeSettings` reports the active profile |
| `backend/src/casino/games/lucky-lady/lucky-lady.adapter.ts` | resolves the active profile per new paid round and pins it in round state |
| `frontend/app/admin/page.tsx` | admin navigation entry |
| `backend/test/lucky-lady.integration.spec.ts` | `issueLaunch` call updated to the shared `LaunchOptions` shape |
| `backend/test/fixtures/coin-flip.adapter.ts` | fixture `read` signature matches the shared `GameAdapter` contract |
| `backend/src/casino/platform/game-adapter.types.ts` | port signatures corrected (`requirePlayer`, `findPreparedIn`, `ownedRound`) |
| `backend/src/casino/platform/game-gateway.base.ts` | `gameplay` accepts a DTO-shaped body |

Nothing was recalibrated, renamed or edited inside the accepted evaluator,
`rules.json`, `lucky-lady.rtp50.v1.json`, the game client or the 185-entry
manifest. Those files are byte-identical; their hashes are re-asserted at
runtime and in the evidence.

## 2. Contract decisions that are proved, not asserted

**Return is measured over the complete paid round.** One paid board plus the
whole free-spin chain it awards, divided by the paid wager. Free spins are
credited inside the originating round and never debit again.

**Max win is support, never a sample maximum.** `lucky-lady.exact.ts` enumerates
every board a profile can actually reach (generated profiles keep weight on at
most two stops per reel, so the space is at most 32 boards) and evaluates each
one with the *same* `engine.evaluate` the runtime uses. A profile whose board
space cannot be enumerated is refused (`LUCKY_LADY_BOARD_SPACE_TOO_LARGE`)
rather than sampled.

**A retriggering feature has no finite complete-round bound.** A free spin that
can return three or more scatters retriggers, so the chain can repeat
indefinitely; `maxRoundMultiplier` is `Infinity` with an explicit basis. The
engine's 20 000-spin safety exception aborts a round, and the acceptance
contract states plainly that a safety exception is not a payout cap - so it is
never advertised as one. Generated profiles therefore either make the feature
unreachable (trigger probability exactly 0, proved by enumeration) or fail the
ceiling check.

**Requesting feature contribution and a finite hard ceiling together is
refused.** `FEATURE_AND_HARD_CEILING_CONFLICT`, with both numbers named. This is
the honest outcome for this game, not a silent downgrade.

**True zero return is proved, not sampled.** The profile
`lucky-lady.rtp0.g90113193f77b` reaches exactly one board, that board wins
nothing, trigger probability is 0 and the proved ceiling is 0.00x. Its 40 000
round Monte Carlo run measured 0.0000% and all 13 checks passed.

**The optional red/black gamble is unbounded.** `luckyLadyAdapter.gamble` sets
`pendingWin = stake * 2` and returns to the `GAMBLE` phase with no attempt cap,
so a settled win can be doubled arbitrarily many times. A policy whose ceiling
scope is `TOTAL_INCLUDING_OPTIONAL_GAMBLE` is refused with
`GAMBLE_UNBOUNDED_TOTAL_CEILING`. This is the fail-closed default while the
user's choice between "ceiling includes gamble" and "ceiling explicitly
excludes the optional gamble" is unanswered. Nothing about the accepted
profile or the live behaviour changed.

**Pacing describes a distribution.** It selects a pre-draw weighting;
nothing calls a player, session, balance, history, round or clock value. The
policy whitelist rejects any such field outright, at both the transport and the
service boundary.

**Immutable identity.** `canonicalHash` covers schema version, profile id, game
id, engine hash, rules hash, policy and payload - and nothing else. Measured
values, status and evidence are outside it, so re-validating or activating can
never change a profile's identity. Every read re-derives the hash from the
stored row and fails closed (`MATH_ARTIFACT_HASH_MISMATCH`) on a mismatch.

## 3. Lifecycle and security

`POST /admin/casino/math/:gameId/generate` - ADMIN only, bounded policy,
returns `SUPPORTED` (persists a `DRAFT`) or `UNSUPPORTED` with per-constraint
reasons. Nothing becomes live.

`POST /admin/casino/math/:gameId/profiles/:profileId/validate` - ADMIN only,
server-produced evidence. The client cannot supply a result, a seed or a hash.
Recomputes the hash, then runs: an analytical reproduction (seed free), a
Monte Carlo run over complete paid rounds on an independent seed domain, and a
complete-session bankroll cohort on a third seed domain, one stream per
session. Persists an append-only `GameMathProfileValidation` and moves the
status to `VALIDATED` or `REJECTED`.

`POST /admin/casino/math/:gameId/profiles/:profileId/activate` - ADMIN only,
requires a `PASS` validation whose `profileHash` still equals the frozen
artifact hash, requires status `VALIDATED`, and moves the per-game pointer
inside a transaction with optimistic concurrency
(`ACTIVE_MATH_PROFILE_CONFLICT`, `MATH_PROFILE_NOT_VALIDATED`,
`MATH_PROFILE_STATUS_NOT_ACTIVATABLE`). Audit rows:
`CASINO_MATH_PROFILE_GENERATED` / `_VALIDATED` / `_ACTIVATED`, plus
`PERMISSION_DENIED` for a non-admin attempt.

Runtime: a new paid round resolves the active profile once, pins
`profileId`/`profileHash` in its own round state and produces the board under
that weighting. An in-flight round, a prepared outcome, a pending feature, a
pending gamble and a recovery payload all keep the identity they were created
with, so activation cannot reach backwards. With no pointer row the game runs
its accepted frozen RTP50 artefact exactly as before.

## 4. Generated mathematics (fresh evidence)

Samples: 40 000 Monte Carlo complete paid rounds and 300 sessions x up to 3 000
paid spins per profile. Full table: `artifacts/math-validation/lucky-lady/summary.md`.
Every requested target from 5% to 100%, plus custom 33.3% and 77.7%, was
generated, validated and (where the checks passed) is activatable.

| Requested | Outcome |
| --- | --- |
| 10, 20, 30, 33.3, 40, 50, 60, 70, 77.7, 80, 90, 95, 100 | `VALIDATED` - exact return within 0.001pp of the target, proved ceiling 12x-20.8x inside the requested 50x |
| 0 with the comparison policy | `UNSUPPORTED` - the return is reachable, but a `MED` volatility tier and a 10x big-win band are not; both numbers are reported |
| 5 | `UNSUPPORTED` - achievable volatility 0.5250 sits below the requested `MED` band |
| 0 with the tiers that a zero-return profile can satisfy (`VOLATILITY_TIER_UNSATISFIED` removed) | `VALIDATED` - `lucky-lady.rtp0.g90113193f77b`, exact 0.0000%, ceiling 0.00x, ruin-by-500 = 1.000 |
| 50 with `featureContribution.minPercent = 10` | `UNSUPPORTED` - `FEATURE_AND_HARD_CEILING_CONFLICT` |
| 50 with `maxWinScope = TOTAL_INCLUDING_OPTIONAL_GAMBLE` | `UNSUPPORTED` - `GAMBLE_UNBOUNDED_TOTAL_CEILING` |

Nothing here is a "best effort" relabelled as success: every rejected or
unsupported row names the constraint, what was requested, and what the game can
actually reach.

## 5. Bankroll validation

Simulation-only denomination: 1 unit = 0.01 PTS (100.00 PTS start, 0.20 PTS
paid stake, 500 fundable spins). The live whole-point ladder is untouched; the
unit exists so the comparison can be stated in exact integers rather than
accumulated floating point.

Accounting rules implemented and tested:

- a paid round is one stake debit and one credit of its complete return; feature
  wins belong to that round and never produce a second debit;
- a session ends when the balance can no longer fund the next stake; reaching
  the horizon while still fundable is **censored**, never "ruined";
- `Alive@N` = could fund the next paid stake after N completed paid rounds;
- checkpoints carry a busted session's terminal dust forward and report `null`,
  not zero, beyond the horizon;
- aggregate return is total return / total **paid** wager, never ending balance
  / starting balance;
- ruin quantiles are restricted to observed ruin and are labelled as such;
- drawdown is measured peak-to-trough over completed-round balances, starting
  balance included;
- quantiles use linear interpolation between closest ranks (R-7), documented
  and tested.

Deterministic fixtures (independent of any real profile), asserted in
`backend/test/game-math-control.spec.ts`:

| Constant return | Paid spins | End balance | Turnover | Notes |
| --- | ---: | ---: | ---: | --- |
| 0x | 500 | 0.00 PTS | 100.00 PTS | ruined by 500, `Alive@500` = 0 |
| 0.5x | 999 | 0.10 PTS | 199.80 PTS | cannot fund the next 0.20 PTS stake |
| 1x | horizon H | 100.00 PTS | 0.20 x H PTS | censored, bust time unknown |
| 2x | 500 | 200.00 PTS | 100.00 PTS | reaches 125/150/200 PTS at 125/250/500 spins, drawdown 0 |

## 6. Commands and results (this workspace)

```
cd backend
node ../node_modules/prisma/build/index.js validate --schema prisma/schema.prisma
  -> The schema at prisma\schema.prisma is valid
node ../node_modules/prisma/build/index.js generate
  -> Generated Prisma Client (v6.19.3)
node ../node_modules/typescript/bin/tsc --noEmit
  -> exit 0
node ../node_modules/@nestjs/cli/bin/nest.js build
  -> exit 0

$env:DATABASE_URL='postgresql://.../casino_math_test'
node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand \
  test/game-math-control.spec.ts test/casino-math.spec.ts test/casino-slots.spec.ts
  -> Test Suites: 3 passed, Tests: 77 passed

$env:MC_ROUNDS='40000'; $env:BANKROLL_SESSIONS='300'; $env:BANKROLL_HORIZON='3000'
node scripts/math-control-evidence.mjs
  -> rows 18, validated 14, rejected 0, unsupported 4

cd ../frontend
node ../node_modules/typescript/bin/tsc --noEmit
  -> exit 0

cd ..
node scripts/acceptance.mjs
  -> games:test PASS, typecheck PASS, build PASS (frontend emits the new
     /admin/casino/math route at 6.03 kB), backend:test FAIL because no
     isolated *_test DATABASE_URL exists in this workspace. The guard was not
     bypassed: the same pre-existing gap is reported by the harness, not worked
     around.
```

## 7. Not verified here

- **PostgreSQL integration suites were not executed.** No PostgreSQL and no
  Redis are running in this workspace, and `backend/test/setup.ts` correctly
  refuses to start without an isolated `*_test` database. The new
  `game-math-control.integration.spec.ts` (ADMIN vs USER authorization, the
  generate/validate/activate lifecycle, optimistic concurrency, restart
  pointer, a tampered payload refused for hash mismatch, unknown-game 404,
  body-whitelist 400, and the runtime pin: the accepted profile until
  activation, the activated identity for new rounds, and an already-created
  round keeping its own persisted pin after a later activation) and the full
  Lucky Lady regression suite (`board15/15`, wallet/ledger, free spins
  retrigger 15->30, gamble win/loss, recovery, IDOR, zero outbound) are written
  but unrun here. They must be run against a disposable `_test` database.
- **Browser harness.** `games/lucky-lady/evidence/browser-check.cjs` and
  `backend-harness.cjs` were left as the extraction left them; no browser run
  was performed in this workspace.
- **Alembic-style migration replay.** The migration is additive and was
  generated from the Prisma schema diff; it has not been applied to a live
  database here.
- **Feature-bearing profiles.** No profile that keeps a retriggering feature
  can pass the hard-ceiling check for this game, so the validated set is
  feature-free (feature trigger rate 0.00000 in every row). That is a finding,
  not an omission: the reason is recorded verbatim in the unsupported rows.
- **The max-win/gamble scope question is still open with the user.** Until it
  is answered, activation of any profile whose ceiling claims to include the
  optional gamble fails closed.

## 8. Evidence index

- Machine evidence: `artifacts/math-validation/lucky-lady/<profileId>/{profile,validation,bankroll}.json`
- Comparison table: `artifacts/math-validation/lucky-lady/summary.{json,md}`
- Unsupported rows: `artifacts/math-validation/lucky-lady/unsupported/*.json`
- Human bankroll reports: `docs/agent-work/game-math-profiles/reports/lucky-lady/<profileId>-bankroll.md`
