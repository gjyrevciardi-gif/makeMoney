# Book of Ra Classic: shared admin DEFAULT reset + focused lifecycle evidence

Run: classic_integration_twohour (DeepSeek V4.1 Flash executor), 2026-10-08.
Branch `feature/book-of-ra-current`, HEAD `d6cb445d29dc6fae0f783bcfb15e1c5e13873fbc` (uncommitted, as agreed).
Status: **BLOCKED / PARTIAL**. Three production corrections applied; a fourth distinct
runtime blocker was found in shared `activate()` and deliberately NOT fixed (Astra stop order;
the run already used its three permitted production corrections).

## 1. What was delivered (Phase A: generic DEFAULT reset)

`POST /admin/casino/math/:gameId/default` (capability `GAME_MATH_MANAGE`), additive and
game-agnostic, with no Classic-specific endpoint and no copied Lucky Lady logic:

- `backend/src/casino/platform/math-control/math-control.types.ts`: `GAME_MATH_DEFAULT_RESETTERS`
  token, `GameMathDefaultResult`, `GameMathDefaultResetter`, and the optional
  `GameMathAdapter.defaultProfile()` ("the game's registered immutable default").
- `backend/src/casino/games/book-of-ra-classic/classic.math-adapter.ts`:
  `defaultProfile()` returns the frozen `book-of-ra-classic.rtp50.v1` id + hash.
- `backend/src/casino/platform/math-control/math-control.service.ts`: `resetToDefault(actorId,
  gameId, {actionId?, expectedVersion?})` -> `registry.adapter(gameId)` (existing
  `GAME_MATH_NOT_INTEGRATED` 404 for an unintegrated game) -> per-game delegate, else the shared
  CAS pointer move. The shared move writes `kind='DEFAULT'`, `profileRowId=null`, the *registered
  default identity* (from `adapter.defaultProfile()`), `version+1`, and an audit row in the same
  transaction. `activeProfile()` is unchanged (`DEFAULT`/null row -> `null` -> the game's frozen
  default for NEW rounds). With no declared default the identity stays empty, exactly as before.
- `backend/src/casino/platform/math-control/math-control.controller.ts`: `@Post(':gameId/default')`.
- `backend/src/casino/platform/math-control/math-control.dto.ts`: `ResetMathDto`.
- `backend/src/casino/casino.module.ts`: supplies `GAME_MATH_DEFAULT_RESETTERS = [LuckyLadyPayoutService]`.
- `backend/src/casino/games/lucky-lady/payout/lucky-lady-payout.service.ts`: `readonly gameId` and a
  thin `resetToDefault` alias over the existing `restoreDefault` (same advisory-locked transaction,
  same history/audit rows, same distribution clearing). No LL code was copied; the legacy
  `admin/casino/math/lucky-lady/payout/default` route is untouched.

Audit contract note: `AuditLog.action` is the PostgreSQL enum `AuditAction`; a distinct
`CASINO_MATH_PROFILE_DEFAULT` value would need a migration (out of scope), so the existing
`CASINO_MATH_PAYOUT_LIFECYCLE` action is reused with `metadata.action='DEFAULT'` - the same
convention the Lucky Lady panel already uses.

Optimistic guard (Astra review point): the `expectedVersion` check is evaluated **before** the
already-DEFAULT early return, so a stale version is refused even when the game is already on default.

## 2. Focused evidence (saved, rerunnable)

`backend/test/book-of-ra-classic.default-integration.spec.ts` - 7/7 PASS
(`npm run test -- test/book-of-ra-classic.default-integration.spec.ts`, exit 0, 29.2s):

1. ADMIN-only on the shared route; a player gets 403 and nothing is created.
2. An unintegrated game (`book-of-ra-deluxe`) gets the established 404 `GAME_MATH_NOT_INTEGRATED`.
3. `registry.adapter('book-of-ra-classic').defaultProfile()` == `{book-of-ra-classic.rtp50.v1, <frozen hash>}`;
   no Deluxe fallback.
4. A non-DEFAULT pointer is control ON even when its profile is a zero-return one: reset bumps
   version 4 -> 5, audit `action=DEFAULT, from=CUSTOM, previousProfileId=<rtp0 fixture>`,
   `defaultProfileId=book-of-ra-classic.rtp50.v1`, and the immutable row is not deleted.
5. Full operator lifecycle: `generate` (50% BALANCED, RESOLVED_SPIN, 201 SUPPORTED) -> structural
   proof -> real Prisma/PostgreSQL round-trip hash proof -> `validate` PASS -> `activate` -> custom
   policy live (`activeProfile` returns it) -> `getSettings` reports the custom profile -> one paid
   action (server-authoritative response with `recovery.profile == {id, hash, version}`) -> identical
   same-session request replays the stored response with no redraw and no second round -> reset to
   DEFAULT with `profileId/profileHash = book-of-ra-classic.rtp50.v1` -> CURRENT `kind='DEFAULT'`
   with the registered identity -> `activeProfile` null -> `getSettings` reports the frozen default ->
   the round in flight keeps its origin `profileId/profileHash` -> profile + validation + activation
   audit rows all survive -> LL pointer/history/audit byte-identical (cross-game isolation) ->
   stale `expectedVersion` rejected with `ACTIVE_MATH_PROFILE_CONFLICT`.
6. Lucky Lady: the delegate is registered and is `LuckyLadyPayoutService`; the legacy
   `.../lucky-lady/payout/default` route returns `action=DEFAULT, replay=false, active.mode=DEFAULT`;
   the generic `.../lucky-lady/default` adds a second `DEFAULT` history row and a second lifecycle
   audit row (proving it ran the panel transition, not a bare pointer write); a player token gets 403.
7. Never-activated Classic: one explicit DEFAULT row materialised with the registered identity,
   one audit row; a repeat with the same `expectedVersion` is idempotent (version stays 1, one audit
   row); a stale `expectedVersion` is refused with 409.

Lucky Lady regression (required focused spec, whole-round scope):
`npm run test -- test/game-math-control.integration.spec.ts` - 6/6 PASS (exit 0, 26.3s).

Typecheck: `npm run typecheck` (backend) PASS after every source edit (final run exit 0).

## 3. Defects found, with source evidence

**#1 - generated profile could never re-derive its hash from the request policy.** The Classic
adapter stamps `maxWinEnabled: true` into the artifact policy for a RESOLVED_SPIN profile, but
`generate` persisted the raw request policy. Correction (applied): persist `artifact.policy`
(`math-control.service.ts`, generate). Necessary, not sufficient.

**#2 - PostgreSQL jsonb does not round-trip the generated derived floats.** Measured on the same
artifact: in-memory hash matched, `JSON.stringify/parse` round trip matched, Prisma -> jsonb round
trip did not; first differing leaves `payload.tables.1.featureReturn 51.695275009228496 ->
51.6952750092285`, `tables.2.triggerProbability 0.0040352315273437505 -> 0.00403523152734375`,
`tables.3.expectedRtpPercent 49.999999596671806 -> 49.99999959667181`,
`tables.3.featureReturn 146.64835164835165 -> 146.6483516483516`. Every DB-stored Classic profile
was therefore unverifiable (`MATH_ARTIFACT_HASH_MISMATCH` in `artifactFromRow`). Astra approved fix 1
as production correction #2: quantize ONLY the six derived analytic metadata fields to 9 decimal
places, before hashing (`classic.math-adapter.ts`, `normalizeAnalyticMetadata`). Proof in the spec:
stop windows, free support and `positiveMass` are identical to the raw engine output; only those six
fields differ by <= 5e-10; the stored row re-derives its own canonical hash. Frozen artefacts,
shared `canonicalProfileHash`, LL, Deluxe, RNG, reels, paytable and search bounds are untouched.

**#3 - the shared activation gate required a check that cannot hold for RESOLVED_SPIN.** `activate`
required `RTP_WITHIN_BOUND_TIMES_HIT_RATE` for every scope, while the Lucky Lady adapter itself
documents (`lucky-lady.math-adapter.ts:455-467`) that this whole-round identity `E[X] <= M*P(X>0)`
"is deliberately not asserted for RESOLVED_SPIN, where one round may resolve many bounded spins".
Any RESOLVED_SPIN profile could therefore never activate. Astra accepted the scope-aware fix:
`requiredActivationChecks(scope)` keeps all seven checks for whole-round scopes (so LL whole-round
evidence is unchanged) and drops only that identity for RESOLVED_SPIN; `REQUIRED_ACTIVATION_CHECKS`
stays exported unchanged, and the per-resolution ceiling is still proved by
`MAX_WIN_PROVEN_WITHIN_CEILING`. Evidence it was pre-existing: LL whole-round activation still
passes (6/6).

**#4 - UNFIXED, run-stopping: shared `activate()` never resets `kind` on an existing pointer.**
`math-control.service.ts` `activate()` (line 377) uses
`tx.gameActiveMathProfile.updateMany({ where: { gameId, version }, data: {...} })` at line 476 with
its data block at line 478; the block sets `profileRowId/profileId/profileHash/validationId/version/
activatedBy/activatedAt` and **no `kind`** (and does not clear a legacy `payoutCandidateId`). The
insert path is fine because the column default is `GENERATED`. Consequently
`DEFAULT -> ACTIVATE` reports success but leaves `kind='DEFAULT'`, and `activeProfile()` (line 659,
`if (!pointer || pointer.kind === 'DEFAULT' || pointer.profileRowId === null) return null`) reports
no active profile, so NEW paid rounds stay on the frozen default. The Lucky Lady *panel* is not
affected (its own `movePointer` sets `kind`), but the shared lifecycle is.

No existing focused test proves the post-DEFAULT `kind`/runtime behaviour, and this spec does not
cover it either: the lifecycle test activates from a never-activated state (insert path, `GENERATED`),
`game-math-control.integration.spec.ts` only re-activates an already-`GENERATED` pointer, and the LL
panel spec uses the panel's own service. The defect is latent but real, and fixing it would be a
fourth production correction, which the run rules forbid. Work stopped here on Astra's instruction.

## 4. Gaps and limitations (honest)

- Shared-surface `HISTORY`/`ROLLBACK` for Classic do not exist (only CURRENT/PROFILES/DETAIL/
  GENERATE/VALIDATE/ACTIVATE/DEFAULT). Reported as a gap; not mislabelled as rollback.
- `MAXWIN50` remains `UNVERIFIED_EVIDENCE_MISSING` (accepted, not a blocker for this integration).
- Launch/registry roles, paid-action gateway and outbound behaviour were not re-run: this change adds
  no new runtime/launch network path. Retained prior accepted evidence (phase 2/3, GATEWAY-REPORT.md).
- Validation artefacts are written by the framework on every validate run; the LL JSON/MD artefacts
  and the new `book-of-ra-classic` artefact folders in this worktree are test-run outputs, not hand edits.

## 5. Next checkpoint for Astra

Read `RUN-DIFF-BASELINE.md` (paths, baseline vs post-run status, command log, counters) and the saved
diff `run-diff/my-changes-vs-foundation.diff`. Decide whether to authorise the fourth correction
(set `kind='GENERATED'` and clear `payoutCandidateId` in the shared `activate()` updateMany, plus a
focused regression asserting DEFAULT -> ACTIVATE -> `activeProfile` non-null -> new round pins the
custom profile), or to stop the run and keep the three applied corrections.
