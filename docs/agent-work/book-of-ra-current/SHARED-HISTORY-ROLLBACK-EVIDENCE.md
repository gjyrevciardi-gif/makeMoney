# Book of Ra Classic: generic shared HISTORY + ROLLBACK

Worktree `C:\Users\Admin\orca\workspaces\toto\book-of-ra-current`, branch
`feature/book-of-ra-current`, HEAD `d6cb445d29dc6fae0f783bcfb15e1c5e13873fbc`
(uncommitted, as agreed). Everything below is the run delta of this task, taken
against the **dirty baseline on disk** (prior generic DEFAULT + activate fix
preserved), not against HEAD.

## 1. Wire protocol

| | |
| --- | --- |
| HISTORY route | `GET /admin/casino/math/:gameId/history?limit=1..200` (default 50) |
| ROLLBACK route | `POST /admin/casino/math/:gameId/rollback` body `{ actionId?: 8..120, expectedVersion?: int>=1 }` |
| Capability / guards | `GAME_MATH_MANAGE` + `AccessGuard`/`RolesGuard` (as every math route), rate limit `admin:math`, actor from the request, never the body |
| Unknown game | the established `GAME_MATH_NOT_INTEGRATED` 404 (no silent fallback) |

HISTORY entry: `{ id, actionId, action: ACTIVATE\|ROLLBACK\|DEFAULT, kind:
DEFAULT\|GENERATED, version, profileId, profileHash, candidateId, actorId,
createdAt, previous:{kind,version,profileId}, target:{kind,version,profileId}|null }`,
ordered by `version` desc (the same ordering and the same append-only rows the
Lucky Lady panel already returns). `kind` is the existing pointer contract:
`DEFAULT` is the game's registered default (control off), `GENERATED` is an
activated profile (the semantic CUSTOM state, control on).

ROLLBACK result: `{ gameId, action:'ROLLBACK', replay, version, kind, profileId,
profileHash, validationId, candidateId, activatedAt, activatedBy }` - the live
transition reports the state it produced (including the registered default
identity when the target was DEFAULT); an exact action-id replay reports the
recorded row instead.

## 2. What changed (all additive; no schema change, no migration)

* `backend/src/casino/platform/math-control/math-control.types.ts`:
  `GAME_MATH_LIFECYCLE_OWNERS` token, `GameMathStateRef`, `GameMathHistoryEntry`,
  `GameMathHistoryView`, `GameMathRollbackResult`, `GameMathLifecycleOwner`.
* `math-control.dto.ts`: `RollbackMathDto`.
* `math-control.controller.ts`: `@Get(':gameId/history')`,
  `@Post(':gameId/rollback')` on the existing controller (same throttle/capability).
* `math-control.service.ts`: public `history()` / `rollback()`; the activation
  gate extracted verbatim into `requireActivatable()` and reused by rollback;
  the shared pointer move now appends one append-only lifecycle row in the same
  transaction as the pointer (`recordSharedTransition`); private helpers
  (`writeSharedPointer`, `stateSnapshotOf`, `stateRefOf`, `previousStateOf`,
  `historyEntry`, `rollbackResult`, `auditLifecycle`, `lifecycleOwner`).
  Rollback runs under `pg_advisory_xact_lock('casino:config:<gameId>')` then
  `'casino:math:lifecycle:<gameId>'` and the same CAS `version` guard, and
  appends pointer + history + audit atomically.
* `casino.module.ts`: `GAME_MATH_LIFECYCLE_OWNERS = [LuckyLadyPayoutService]`
  (the existing DEFAULT-reset delegate list is untouched).
* `lucky-lady-payout.service.ts`: thin `rollbackMath()` alias over the panel's
  own `rollback` (same advisory-locked transaction, same candidate restore, same
  runtime distribution) projected into the shared shape. Legacy routes untouched.
* `backend/test/book-of-ra-classic.shared-history-rollback.spec.ts` (new, 6 tests).

Storage decision: the existing game-scoped append-only lifecycle table
(`LuckyLadyPayoutActivation`, `@@unique([gameId, actionId])`) **does**
accommodate Classic - a shared row carries `candidateRowId=null`,
`candidateId=null`, `policyHash=null` (no fake Lucky Lady candidate or
distribution reference) and its own `gameId`, so history is game-scoped and the
action-id replay contract is the existing unique index. A game whose lifecycle is
owned by its own panel (Lucky Lady) keeps its own rows and its own transition:
the shared writer steps aside (`recordSharedTransition` no-ops for an owned game)
and the generic rollback delegates, so no second history dialect is interleaved
into the panel's append-only records and the legacy panel routes keep exactly
their previous semantics.

## 3. Verification (5 significant commands; MAX 5)

| # | command | exit | result |
| --- | --- | --- | --- |
| 1 | `npm run typecheck -w backend` | 0 | `tsc --noEmit` clean (tsconfig includes `src` and `test`) |
| 2 | `npm run test -- test/book-of-ra-classic.shared-history-rollback.spec.ts` | 1 | harness defect in the new spec: the DB rejects `AuditLog.deleteMany` ("AuditLog is append-only"); no production code implicated. Fixed by dropping the audit deletes (append-only by design). |
| 3 | same | 1 | second harness defect: `CasinoRound.deleteMany` cascades into the trigger-protected `LedgerEntry`; plus two wrong expectations in my own spec (`expectedVersion`/version arithmetic in proof 2, and the rollback target in proof 3). Fixed: the spec uses the repo's existing `TRUNCATE ... CASCADE` fixture boundary for the ledger-bound tables and the corrected expectations. |
| 4 | same | 0 | `Tests: 6 passed, 6 total` (35.9 s) |
| 5 | `npm run test -- test/lucky-lady-payout-panel.integration.spec.ts -t "is ADMIN-only and DB-rechecks the role\|starts on the immutable golden default\|keeps the golden default immutable"` | 0 | `Tests: 3 passed, 9 skipped` (the 9 skipped are that file's generator/Monte-Carlo tests, excluded to honour the no-LL-math-sim rule) |

Raw logs: `shared-history-rollback-spec-run.log` (final passing run),
`shared-history-rollback-ll-regression.log`, `run-diff/shared-history-rollback/`
(`baseline-hashes.txt`, `after-hashes.txt`, per-file `BEFORE-*` copies,
`my-changes-vs-dirty-baseline.diff`). The two earlier failing runs used the same
log path and were overwritten; their causes are the two harness defects recorded
above. No validation artifacts were written by these tests (no generate/validate
run) and no production file was reformatted.

## 4. Focused proofs (new spec, real PostgreSQL + Redis, seeded fixtures only)

1. `DEFAULT -> activate A -> DEFAULT -> activate B` over the real controller:
   history versions `[4,3,2,1]`, actions `[ACTIVATE,DEFAULT,ACTIVATE,DEFAULT]`,
   kinds `[GENERATED,DEFAULT,GENERATED,DEFAULT]`, profile ids `[B,null,A,null]`,
   real hashes, `previous` snapshots, `gameId=book-of-ra-classic`, `?limit=2`
   honoured, and no Lucky Lady/Deluxe identity anywhere in the payload.
2. `DEFAULT -> activate A -> activate B -> ROLLBACK`: returns A (version 4,
   `kind=GENERATED`, real hash, `validationId` present), CURRENT pointer
   `GENERATED/v4/profileA`, the rollback entry records
   `previous={GENERATED,3,B}` / `target={GENERATED,2,A}`, an exact action-id
   replay returns the recorded transition without a second row, and a real paid
   round through `ClassicAdapter` pins `{A, hash, version 4}`. Lucky Lady
   pointer/history/audit snapshots and Deluxe are byte-identical afterwards.
3. `DEFAULT -> activate A -> ROLLBACK`: lands on the registered DEFAULT
   (`book-of-ra-classic.rtp50.v1` + frozen hash, `kind=DEFAULT`,
   `activeProfile()` null), then `activate B` yields `GENERATED/v4/B/hash` with
   `payoutCandidateId=null` (no stale tombstone) and a coherent 4-entry history.
4. `GET .../profiles/:profileId` once: correct Classic identity, hash, target RTP,
   max-win, policy metadata and `ACTIVATION`-grade validation; CURRENT (before ==
   after), the pointer and the history length are all unchanged - the preview
   activates nothing.
5. Legacy Lucky Lady routes: `GET .../lucky-lady/payout/history` unchanged shape
   and ordering; `POST .../lucky-lady/payout/rollback` still appends one row and
   lands on DEFAULT; the generic `math.rollback('lucky-lady')` runs that same
   panel transition (proved by the appending panel-shaped row), so the generic
   and legacy routes cannot disagree. No generator/simulation was run.
   Plus: player token 403 on both new routes; `book-of-ra-deluxe` 404
   `GAME_MATH_NOT_INTEGRATED` on both; a game with no recorded transition 409
   `GAME_MATH_NOTHING_TO_ROLLBACK`.

## 5. Limitations / risks for review

* The shared lifecycle history uses the existing `LuckyLadyPayoutActivation`
  table (its only game-scoped, action-id-unique append-only store). Rows written
  by the shared lifecycle carry no candidate/distribution references, but the
  table is named for Lucky Lady; no schema change was made, as instructed.
* `activate()`/`resetSharedDefault()` gained one extra append-only insert inside
  the existing transaction. Audit rows are unchanged, so the accepted
  `CASINO_MATH_PROFILE_ACTIVATED` / `CASINO_MATH_PAYOUT_LIFECYCLE` counts in the
  prior Classic specs still hold (verify in Astra's acceptance pass).
* Shared `activate()` writes a history row only for games the shared lifecycle
  owns; for Lucky Lady's owned lifecycle the panel history is the record (the
  generic route delegates). This keeps the legacy LL history/rollback semantics
  byte-identical, and is the same ownership boundary the DEFAULT reset already uses.
* A client-supplied DEFAULT/activate action id that collides with an existing
  row of the same game surfaces as `GAME_MATH_ACTION_ID_CONFLICT` (409) rather
  than a replay; only rollback implements full replay semantics.
* The new spec's cleanup uses the repo's existing `TRUNCATE ... CASCADE` fixture
  boundary (ledger/audit are trigger-protected append-only tables) in this
  dedicated `book_classic_db_gate_test` database only.
* Rollback re-uses the same `requireActivatable()` gate `activate()` uses, and
  the executed spec proves its positive path runs (a real stored row, hash,
  engine identity and PASS validation were required to land the rollback), but
  no executed case asserts the negative path for a rollback target whose
  validation is missing or tampered.
* Prior accepted regressions beyond the two commands above (the whole
  `book-of-ra-classic.default-integration.spec.ts`, the LL generator suite) were
  not re-run inside the 5-command budget; the prior specs were not modified.
