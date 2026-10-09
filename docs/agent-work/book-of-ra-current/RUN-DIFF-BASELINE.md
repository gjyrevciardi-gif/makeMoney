# Run baseline and diff (classic_integration_twohour)

Branch `feature/book-of-ra-current`; HEAD `d6cb445d29dc6fae0f783bcfb15e1c5e13873fbc` before and after
(no commit, no merge, no push, no deploy). Scheduled start 17:48:32Z; first observed clock 17:50:13Z;
this artefact written 18:05Z; absolute stop 19:48:32Z (never reached).

## Pre-run baseline (`git status --short` at 17:50:13Z)

```
 M backend/nest-cli.json
 M backend/src/casino/casino-config.defaults.ts
 M backend/src/casino/casino-game.registry.ts
 M backend/src/casino/casino.module.ts
 M backend/test/casino-admin-config.integration.spec.ts
 M backend/test/casino-registry-favorites.integration.spec.ts
 M frontend/components/casino/casino-game-card.tsx
?? backend/src/casino/games/book-of-ra-classic/
?? backend/test/book-of-ra-classic.admin-current-default.spec.ts
?? backend/test/book-of-ra-classic.admin-math-registration.spec.ts
?? backend/test/book-of-ra-classic.concurrent-bet-race.spec.ts
?? backend/test/book-of-ra-classic.integration.spec.ts
?? backend/test/book-of-ra-classic.math-control.integration.spec.ts
?? backend/test/book-of-ra-classic.math.spec.ts
?? backend/test/book-of-ra-classic.wallet-replay-recovery.spec.ts
?? docs/agent-work/book-of-ra-current/
?? frontend/app/casino/slots/book-of-ra-classic/
?? games/book-of-ra-classic/
```

None of the four `math-control.*` files, nor `classic.math-adapter.ts`, nor
`lucky-lady-payout.service.ts`, nor any test was modified at baseline except the ones listed above.

## Files this run changed or added

SHA-256 of the current content (lines):

| hash | lines | path |
|---|---|---|
| 7bc27c0e28081ff4f68e747c7857cd5f8f715921f7585eb5beabeef17ffb46d0 | 710 | backend/src/casino/platform/math-control/math-control.types.ts |
| e9c9bdbf0f7903fc741793486ceacb539e2a049e5597e547ff446c00d9da395c | 89 | backend/src/casino/platform/math-control/math-control.dto.ts |
| 1ce6ec82384d8f1c55d0bef79f3f039e51d847439c5dea00c3cb1ae0145aa2c8 | 918 | backend/src/casino/platform/math-control/math-control.service.ts |
| 7be14be125abec2a76c2303dd10fa4f6f6bedc8177d60dabcff5a6dccfcb9567 | 164 | backend/src/casino/platform/math-control/math-control.controller.ts |
| 2dcaab238eade7a1eaab2b9b4e35ef1f59ab6cf1db1eebdf52ba07fed21e6200 | 653 | backend/src/casino/games/book-of-ra-classic/classic.math-adapter.ts |
| 44f666754830da305b33297bca2fe8e490e0e8f42b8a7276efd7582b36de98bc | 1573 | backend/src/casino/games/lucky-lady/payout/lucky-lady-payout.service.ts |
| f18b0eef7d467a1b97afab3357e5388720b40d74adf95d059a7d284fb9932fad | 152 | backend/src/casino/casino.module.ts |
| b1426c61f2526316b6637a84aab1e9a133a67cf34203c382ee28416837498a38 | 560 | backend/test/book-of-ra-classic.default-integration.spec.ts (new) |

`casino.module.ts` was already dirty at baseline, so its saved diff contains both the pre-existing
Classic wiring and this run's `GAME_MATH_DEFAULT_RESETTERS` provider; the other six are entirely this
run's changes. Full diff: `docs/agent-work/book-of-ra-current/run-diff/my-changes-vs-foundation.diff`
(24 KB, `git diff` against the foundation commit).

Removed after use: `backend/test/zzz-diagnose.spec.ts` (temporary hash/precision diagnostic; its
findings are recorded in `DEFAULT-RESET-EVIDENCE.md` section 3, defect #2).

Test-run side effects (not hand-edited): `artifacts/math-validation/lucky-lady/*-1.json` (4 profiles,
4 lines each) and `docs/agent-work/game-math-profiles/reports/lucky-lady/*-bankroll.md` were rewritten
by the required LL focused run; `artifacts/math-validation/book-of-ra-classic/` and
`docs/agent-work/game-math-profiles/reports/book-of-ra-classic/` are new outputs of the Classic
validate run. All other modified/untracked paths are the pre-existing feature work listed above.

## Significant-command log (10 of the 18 cap)

| # | command | exit | result |
|---|---|---|---|
| 1 | `npm run typecheck` (backend) | 1 | TS2820 `CASINO_MATH_PROFILE_DEFAULT` not in `AuditAction` -> switched to the existing lifecycle action |
| 2 | `npm run typecheck` | 0 | clean |
| 3 | `npm run test -- test/book-of-ra-classic.default-integration.spec.ts` | 1 | 5/6; harness assertion `generated.body.profile.policy` undefined (corrected) |
| 4 | same spec | 1 | `MATH_ARTIFACT_HASH_MISMATCH` at `artifactFromRow` (defect #1) |
| 5 | same spec | 1 | same, after defect #1 fix -> defect #2 (jsonb float normalisation) |
| 6 | `npm run test -- test/zzz-diagnose.spec.ts` | 0 | IN_MEMORY true / JSON_ROUNDTRIP true / DB_ROUNDTRIP false (temporary diagnostic, removed) |
| 7 | same diagnostic with value diff | 0 | exact mutated leaves captured (defect #2 evidence) |
| 8 | `npm run typecheck` + same spec | 1+1 | typecheck clean; spec fails at `activate` with `MATH_EVIDENCE_INCOMPLETE` (defect #3) |
| 9 | `npm run typecheck` + same spec | 0+0 | typecheck clean; **7/7 PASS** (29.2s) |
| 10 | `npm run test -- test/game-math-control.integration.spec.ts` (LL focused regression) | 0 | **6/6 PASS** (26.3s) |

Counters: production correction cycles 3 of 3 used (#1 `artifact.policy` persistence, #2 analytic
metadata 9dp normalisation, #3 scope-aware required activation checks); harness corrections 2
(my own `profile.policy` assertion, the temporary diagnostic spec); defect #4 found and NOT fixed.
No HTTP 402, no context exhaustion, no unrecoverable tool or repository-access loss.
