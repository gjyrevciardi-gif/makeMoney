# Book of Ra Classic: shared HISTORY + ROLLBACK acceptance closure

Worktree `C:\Users\Admin\orca\workspaces\toto\book-of-ra-current`, branch
`feature/book-of-ra-current`, HEAD `d6cb445d29dc6fae0f783bcfb15e1c5e13873fbc`
(uncommitted, all prior work preserved). This run closes the two remaining exact
proof gaps of the already-implemented shared HISTORY + ROLLBACK feature; it does
not reimplement or discard the production code from the prior run.

## 1. What changed

One file, spec-only: `backend/test/book-of-ra-classic.shared-history-rollback.spec.ts`.
No production file was touched.

1. `fixtureExpectedRtpPercent(artifact)` (line 180) reads the fixture's expected
   return from the artifact's own recorded analytic metadata
   (`payload.tables['9'].expectedRtpPercent`) - no generator, no Monte Carlo, no
   validation rerun.
2. `seedValidatedProfile` (line 203) now stores `analytic.exactRtpPercent` -
   the real `ProfileAnalysis` preview contract field - alongside the existing
   fixture marker. The `analytic` column is descriptive only; the activation
   gate still reads status, hashes, validation `checks` and `metrics.grade`.
3. Test 2 (`rolls back to A, pins the next paid round to A, ...`) now continues
   the exact user chain past the rollback (lines 458-530):
   `ACTIVATE A -> ACTIVATE B -> ROLLBACK(A) -> EXPLICIT DEFAULT -> ACTIVATE B`,
   asserting versions 2/3/4/5/6, the `DEFAULT` state carrying the registered
   `book-of-ra-classic.rtp50.v1` identity, and B effective at run time
   afterwards. A rollback onto DEFAULT (test 3) is deliberately kept as a
   separate proof and is not substituted for the explicit reset.
4. Test 4 (`serves the real PREVIEW detail with zero activation effect`) now
   asserts the explicit expected-RTP coherence (lines 621-631) on the same
   single PREVIEW response; no extra route call was added.

## 2. Production hash baseline -> after (SHA-256, unchanged)

| path | baseline = after |
| --- | --- |
| `backend/src/casino/platform/math-control/math-control.service.ts` | `0EF3D1B9...816151` |
| `backend/src/casino/platform/math-control/math-control.controller.ts` | `9AE8EF65...B9FE` |
| `backend/src/casino/platform/math-control/math-control.types.ts` | `1A513BAC...FE229` |
| `backend/src/casino/platform/math-control/math-control.dto.ts` | `AC13CAA0...0819D` |
| `backend/src/casino/casino.module.ts` | `2035AB5C...A039A99` |
| `backend/src/casino/games/lucky-lady/payout/lucky-lady-payout.service.ts` | `0C208F12...D414C` |

Full hashes: `run-diff/shared-history-rollback-close/baseline-hashes.txt` and
`after-hashes.txt`. Only the spec file differs (`58FD8B55...5DE83` ->
`run-diff/shared-history-rollback-close/spec-close.diff`, 174 diff lines).

## 3. Verification

| # | command | exit | result |
| --- | --- | --- | --- |
| 1 | `npm run typecheck -w backend` | 0 | `tsc --noEmit` clean |
| 2 | `npm run test -- test/book-of-ra-classic.shared-history-rollback.spec.ts --verbose` (first attempt) | 1 | env construction defect in the runner only: PowerShell parsed `$dbName?schema=public` as a variable name, so the repo's own safety guard rejected the URL (`Unsafe test database: =public`). No test executed. Fixed by concatenating the URL from single-quoted literals. |
| 3 | same, corrected env | 0 | `Tests: 6 passed, 6 total`, `Test Suites: 1 passed, 1 total`, 47.6 s |
| 4 | `npm run test -- test/lucky-lady-payout-panel.integration.spec.ts -t "is ADMIN-only and DB-rechecks the role\|starts on the immutable golden default\|keeps the golden default immutable"` | 0 | `Tests: 9 skipped, 3 passed, 12 total` |
| 5 | evidence capture (hash compare + diff; no test) | 0 | production hashes unchanged, spec diff written |

Targets: PostgreSQL `boc-dbgate-pg` `127.0.0.1:55434`, database
`book_classic_db_gate_test`, user `gate_runner` (password read from the
container env, never printed); Redis `127.0.0.1:56380`. Both env vars were set
per process only. Isolation re-checked before the run: `current_database() =
book_classic_db_gate_test`, `current_user = gate_runner`, 26 tables present.

Logs: `run-diff/shared-history-rollback-close/typecheck.log`,
`shared-history-rollback-spec-run.log`, `ll-focused-regression.log`.
Prior-run logs were not overwritten.

## 4. Assertion excerpts (spec lines)

Exact chain (test 2):

```ts
const reactivated = await activate(CLASSIC_PROFILE_B, 5);
expect(reactivated).toMatchObject({ profileId: CLASSIC_PROFILE_B, version: 6 });
...
const effective = await math.activeProfile(CLASSIC_ID);
expect(effective?.version).toBe(6);
expect(effective?.artifact.canonicalHash).toBe(b.canonicalHash);
const chain = (await history(CLASSIC_ID)).entries;
expect(chain.map((entry) => [entry.action, entry.kind, entry.version])).toEqual([
  ['ACTIVATE', 'GENERATED', 6],
  ['DEFAULT', 'DEFAULT', 5],
  ['ROLLBACK', 'GENERATED', 4],
  ['ACTIVATE', 'GENERATED', 3],
  ['ACTIVATE', 'GENERATED', 2],
  ['DEFAULT', 'DEFAULT', 1],
]);
```

with `explicitDefault` asserted as `{ mode: 'DEFAULT', version: 5, profileId:
'book-of-ra-classic.rtp50.v1', profileHash: defaultClassicProfile().hash }`, the
pointer `kind=DEFAULT/profileRowId=null`, `math.activeProfile()` resolving
`null`, and the cross-game Lucky Lady pointer/history/audit snapshots compared
after the entire chain.

Explicit expected-RTP (test 4):

```ts
const fixtureRtpPercent = fixtureExpectedRtpPercent(a);
const previewAnalytic = preview.profile.analytic as { exactRtpPercent?: number | null };
expect(previewAnalytic.exactRtpPercent).toBeCloseTo(fixtureRtpPercent, 8);
expect(Math.abs(Number(previewAnalytic.exactRtpPercent) - a.policy.targetRtpPercent)).toBeLessThanOrEqual(0.01);
expect(preview.profile.profileId).toBe(CLASSIC_PROFILE_A);
```

Fixture value used: `payload.tables['9'].expectedRtpPercent` =
`50.000000254` (the quantized recorded analytic value of the frozen rtp50
artifact); the profile's declared target is `50`.

## 5. Risks / limits

* The fixture analytic object is intentionally partial (`kind`,
  `exactRtpPercent`); it is not gate-relevant and the real `ProfileAnalysis`
  field name and value are what the PREVIEW proof asserts.
* The seeded expected RTP comes from the artifact's recorded analytic metadata
  (quantized to 9 decimals by the Classic adapter before hashing), not from a
  fresh `analyze()` recomputation - by design, to keep this closure free of
  generator/simulation/validation work.
* Prior accepted regressions beyond the two commands above were not re-run in
  this 5-command budget.
