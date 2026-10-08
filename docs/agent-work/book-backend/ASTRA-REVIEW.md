# Astra backend review — 2026-09-23

## Blocker-fix follow-up — accepted for the requested backend commit

This follow-up supersedes the historical acceptance decision below. All four requested blocker groups are resolved in one implementation pass and one verification/correction pass. Final validation: **127/127 Book tests** (90 package tests plus 37 platform tests), preserving the original 63 and adding ten focused regressions in this pass. No broad casino tests or RTP simulations were rerun.

- Maintenance/disablement gates only new paid wagers. Persisted free games resume after a service restart with their original bet and expanding symbol; pending gambles collect once during maintenance. Focused PostgreSQL tests exercise both paths.
- SQLite atomic commits recheck the scoped key and the exact prior feature state under `BEGIN IMMEDIATE`. Concurrent duplicates replay the first committed result; different stale requests fail before debit. Two independent SQLite connections prove one reservation and one debit. Concurrent collect credits once. Book rejects providers without atomic persistence.
- Every Book host response projects away future colours and raw draws, and hashes the public projection rather than leaking a hash of hidden colours. Persisted private state remains intact for recovery. Direct runtime spins cannot overwrite a pending gamble. The earlier note about missing HTTP autoplay forwarding was incorrect: the existing HTTP adapter already forwards it and needed no edit.
- Legacy SQLite tables upgrade in place transactionally; the original idempotency rows remain preserved, pending-round indexes are rebuilt, and reopened pending wagers can collect. Old keys lack request-body fingerprints, so ambiguous retries fail closed instead of charging again. No existing database was deleted/recreated to pass validation.
- A follow-up PostgreSQL migration preserves applied migration history and restores positive stakes for every non-Book round. Zero stakes require Book's profile and persisted free-game state; Book bets must equal ten whole-point lines. Host limits now check the total ten-line wager rather than only the line stake. The migration applied successfully to the existing isolated test database, and SQL-level regression tests reject malformed/foreign zero-stake rounds.

The validated global RTP profile fingerprint remains unchanged; observed saved RTP remains **49.9976%**. The two-million-spin report was not rerun. The four requested blockers have no remaining acceptance findings. The historical audit-draw-retention observation is outside these four fixes and was not expanded into unrelated work.

Commit scope: 44 source/configuration/test/migration/required-runtime-artifact files. Excluded and preserved locally: this review, worker README, saved simulation report, machine logs, caches and other ignored test artifacts. Evidence: `tmp/astra-review/blocker-full-book.log`, `blocker-full-platform.json`, `blocker-migration.log`, `blocker-host.log`, and `blocker-platform.json`. The `_test` safety guard remained unchanged. No UI/Gates/authentication/policy changes were made.

## Historical review before blocker fixes

**Not accepted for commit.** Branch `feature/book-backend-final`, base `74c841a61245d4851abf6bba5a82a4873b97e313`. All partial work and the single review fix pass remain uncommitted. No delegation, UI changes, dependency installation, merge, push, or large simulation rerun during this review.

## Blocking findings

1. **Production recovery is blocked by maintenance.** `backend/src/casino/games/book-of-ra/book-of-ra.service.ts:187` checks `assertPlayable` before distinguishing an already-awarded free game from a new paid spin. The same check at line 308 blocks collection/resolution of an existing gamble. State refresh also checks the registry switch at line 157. `CasinoConfigService.assertPlayable` explicitly documents that it is only an admission check for new rounds. Static control-flow finding: maintenance/disablement must not strand already-debited obligations.
2. **Future gamble colours are returned by the reference host.** `packages/slot-skills/runtime/src/engine.ts:160` includes private `bookOfRa.gambleColours` in `featureState`, and line 172 includes the raw gamble draws. The reference HTTP server sends/broadcasts that result and returns stored state without projection. A current-code probe returns all five future colours. The production Nest adapter uses a separate sanitized projection; this finding concerns the changed reference-host path, not that adapter.
3. **Concurrent duplicate requests debit twice in the reference host.** Its replay lookup precedes computation and the SQLite transaction. `packages/slot-skills/host/src/sqlite.ts:196` does not recheck the key inside `commitRound`; `INSERT OR REPLACE` overwrites the idempotency record. Two concurrent requests with one key both succeed, produce two rounds, and reduce a 10,000-point wallet to 9,800 for one intended 100-point losing spin. Platform PostgreSQL duplicate-spin tests pass; this is a separate path.
4. **Existing SQLite databases cannot upgrade.** The old idempotency table has only `request_key` and `result_json`. `CREATE TABLE IF NOT EXISTS` leaves that table intact, while new queries require scoped columns and `fingerprint`. Opening a database with the exact HEAD table shape and reading a key fails with `no such column: fingerprint`. Existing pending rounds also have no backfill into the new `open_round` table.
5. **The free-spin migration weakens a platform-wide invariant.** `20260923120500_casino_round_allows_free_spin/migration.sql` changes every casino round from positive to nonnegative stake. This is broader than the Book-only exception required. Other game services retaining request validation does not preserve the database guarantee. Constrain zero stakes to valid Book free rounds before accepting this migration.

Additional gaps: the generic Book engine discards a restored pending gamble when called directly (`engine.ts:73`); the host normally guards that call, but its concurrent path does not. Gamble resolution in the production adapter replaces the original private draw evidence with an empty array (`book-of-ra.service.ts:344`). The reference HTTP spin adapter does not forward `autoplay`, so its browser path can still offer gamble during autoplay. These are recorded, not expanded into a second implementation pass.

## One bounded fix pass

- Enforce the effective minimum total stake before wallet debit/RNG and publish its rounded-up per-line minimum.
- Give operator configuration revisions distinct labels while preserving the immutable mathematics profile ID.
- Report ten awarded free games in the generic runtime's introduction event instead of the previous state's zero.
- Remove stale pending-action data after collect/loss.
- Repair the low-symbol expansion test to actually land that symbol on two and three nonadjacent reels.

Five additional test cases cover the fixes; one existing new test was strengthened. No mathematics, weights, RNG, migration, or host persistence fixes were attempted in this pass.

## Independent validation

- `npm run game:book:test`: **83 passed**, including the original **63 unchanged tests** and **20 new runtime tests**. Original tracked test files have no diff against HEAD.
- Book-only platform Jest suites: **34 passed**, comprising 9 published-profile tests and 25 PostgreSQL integration tests. Combined Book total: **117 passed**; 54 are new versus HEAD (49 worker tests plus 5 review tests).
- Before the fix pass, the two Book platform suites and four named casino suites ran together: **154 passed, 6 failed**. All 31 Book platform tests passed at that point. The broader suites were not rerun after the bounded fixes.
- Prisma schema validation passed. Read-only Prisma diff between the migrated candidate test database and the schema is empty. This verifies structural agreement, not the acceptability of the weakened SQL check.
- PostgreSQL: isolated port 54329, candidate database `book_backend_test`; clean base database `book_review_base_test`. The unchanged platform `_test` safety guard ran. Redis used a review-only instance on port 56381, not the shared instance.
- Current-code probes confirm the host disclosure, double debit, and SQLite upgrade failure; they also confirm terminal pending-action cleanup is fixed.

## Clean-base regression comparison

The six failing cases were run against an extracted **clean HEAD backend**, its original Jest configuration, and a separate database migrated only with HEAD migrations. All **142 extracted backend files** match Git blobs after normalizing archive CRLF conversion (140 files needed normalization). The same installed dependencies were used for both runs. The base run selected only these six cases: **6 failed, 123 skipped**.

| Suite | Failing expectation | Clean HEAD | Candidate |
| --- | --- | --- | --- |
| admin-config | seeded game count | expected 7, got 8 | expected 7, got 9 |
| admin-config | configuration classes | extra Titans entry | extra Titans and Book entries |
| crash-plinko-security | playable game types | one extra SLOTS | two extra SLOTS |
| slots-security | playable game types | one extra SLOTS | two extra SLOTS |
| slots-security | public slot configuration count | expected 1, got 2 | expected 1, got 2 |
| registry-favorites | slot category IDs | extra Titans entry | extra Titans and Book entries |

Thus all six failures existed at HEAD, but Book contributes to five already-stale registry expectations. They are not six unchanged failure outputs and the candidate casino suite is not green. No Gates code or expectations were changed.

## Saved RTP report validation

The simulator calls the same `playBookOfRaRound` implementation as the platform, seeds a test RNG, completes each awarded feature including retriggers, and divides both base and free-game wins by paid wagers. Autoplay excludes gamble. Production uses unbiased server-side `node:crypto` draws. The immutable global profile and weights contain no user/session/history-dependent outcome adjustment; persistent feature state implements the published feature rules only.

Saved seeds: 20260923 and 20260924, one million paid spins each. Profile fingerprint: `a2dd659daf50a38b05e7f36f7b89f2633898babe42f525f31861b2dc01f30e21`.

| Metric | Independently calculated from saved integer totals |
| --- | --- |
| Paid / free spins | 2,000,000 / 22,610 |
| Total paid wager | 200,000,000 points |
| Base / feature / total return | 90,751,700 / 9,243,500 / 99,995,200 points |
| Total RTP / house edge | 49.9976% / 50.0024% |
| Base / feature RTP | 45.37585% / 4.62175% |
| Paid-spin hit rate | 27.61855% (552,371 / 2,000,000) |
| Free-game trigger rate | 0.11135% (2,227 / 2,000,000 paid spins) |
| Retrigger rate | 0.15037594% (34 / 22,610 free spins) |
| Average feature return | 41.506511 times total bet, excluding triggering paid-spin winnings |

Per-seed totals sum correctly; each seed satisfies `freeSpins = 10 * (triggers + retriggers)`. The stored fingerprint matches the current compiled profile, and the report's digest recomputes correctly. The digest covers the profile and selected per-seed totals, **not every report field**; this is methodology and internal-consistency validation, not a fresh reproduction of all two million outcomes. No large rerun was necessary. The bounded fixes do not change the simulated math/round function.

The saved percentage formatter truncates base/feature figures; the table above uses exact integer ratios. `scattersLanded` is never incremented and must not be treated as measured data. Gamble is separate: 20,000 fixed-red ladder trials, 10,000,000 points initially at risk, 10,128,000 settled (101.28% sample return); it is excluded from all slot RTP figures.

## File classification and evidence

All **44 pre-review changed/untracked files** were inspected: **35 source/configuration files, 3 test files, 2 migrations, 2 generated runtime bundle/lock files, and 2 report artifacts**. The generated game bundle/lock are runtime inputs and must be assessed separately from disposable reports. Worker `README.md` and `simulation.json` are evidence artifacts, not executable implementation. This review adds one report, making 45 visible changed/untracked files. No direct UI/CSS/art/assets/Gates/game-3 changes were found. Shared host/runtime changes and the global SQL check have cross-game implications, so scope isolation cannot be accepted without qualification.

Detailed inventory and raw validation remain under ignored `tmp/astra-review/`: `file-inventory.json`, `regression-comparison.json`, `candidate-tests.json`, `base-tests.json`, `book-after-fixes.log`, `book-platform-after-fixes.json`, `simulation-validation.json`, `book-review-probes.mjs`, and `book-probes-after-fixes.json`. Machine logs, extracted baseline, test databases, and dependency build output are not commit candidates. No files were staged or discarded. **No commit: acceptance is blocked by the findings above.**
