# Astra review: conditional checkpoint balance reporting

Verdict: **ACCEPTED**, 2026-10-04. This review resolves the checkpoint-conditioning blocker in the historical `ASTRA-REVIEW.md`, which remains preserved. DeepSeek V4.1 Flash implemented the scoped change; Astra reviewed the actual patch against the pre-task dirty-worktree baseline and accepted it after one correction pass.

## Scope and behavior

Only the offline policy-bankroll report module, its evidence driver, focused tests, and affected Lucky Lady reports changed. The accepted session accounting, payout policy, weights, native outcomes, CSPRNG, MaxWin, RTP, and ruin calculations remain unchanged. No profiles were activated.

`balance[N]` now summarizes only records with `paidSpins >= N`. It carries totalSessions, reachedCheckpoint, conditionalSampleSize, and survivalRate. Mean, median/P50, P10, P25, P75, P90, and P95 use this population; an empty population has null statistics. `unconditionalBalance[N]` is separately labelled and represents sessions ruined before N as zero, including sessions with nonzero terminal dust. Actual dust remains in the exact checkpoint that was reached.

The existing `Alive@N` statistic means the balance after N can fund N+1. It remains unchanged. Checkpoint reach is reconciled to that existing statistic with the exact boundary identity:

`conditionalSampleSize / totalSessions = existing Alive@N rate + exactCheckpointRuin / totalSessions`

This identity does not claim the raw rates are equal at an exact-ruin boundary. LOSS100 reaches 500 in every session, although no session can fund 501. Both the count and rate reconciliation are explicit in the reports and tested.

## Acceptance evidence

1. Early-ruined sessions are excluded from every conditional statistic; mixed-cohort tests assert every requested quantile.
2. Sessions resolving exactly the checkpoint are included even if the next stake cannot be funded, including nonzero dust.
3. The same ruined sessions are excluded at later checkpoints; unconditional statistics zero-absorb them.
4. Conditional counts and rates reconcile with the accepted survival statistic using the boundary identity above. Astra independently checked all 42 checkpoint rows across six regenerated reports.
5. Horizon-censored sessions retain their actual balance at the horizon; beyond-horizon checkpoints remain unobserved with null statistics.
6. BREAK_EVEN100 retains 100 PTS at every configured checkpoint through 10,000 spins.
7. LOSS100 reports 80 / 50 / 0 PTS at 100 / 250 / 500; all 120 sessions reach 500, none funds 501, and later conditional samples are empty.
8. Labels distinguish `Balance @N | survivors only` from `Balance @N | all sessions, ruin=0`; median is identified as P50.
9. Astra's before/after checks found no changes to RTP, turnover, house results, policy frequencies, dry spells, MaxWin, or existing survival/ruin fields. Paid spins remain 3,199,518; free spins 41,880; resolved spins 3,241,398.
10. All reports retain `testOnly: true` and `activated: false`; no activation occurred.

## Validation and artifacts

Flash ran `npx tsc --noEmit` successfully and the exact focused Jest command below: **2 suites, 16 tests passed**. Astra inspected the saved test output and tests, then independently checked artifact invariants and checkpoint identities. No full backend suite, browser tests, or PostgreSQL integration ran.

```text
node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand test/payout-policy-bankroll.spec.ts test/lucky-lady.session-source.spec.ts
```

Six fixture JSON/Markdown pairs and comparison JSON/Markdown were regenerated using the original seeds, session counts, horizon, and generatedAt timestamp. Reporting now includes balance@10000, already supported by the horizon and survival checkpoints. The extra report checkpoint changes the config-derived runId without increasing simulation size. Comparison runtime metadata changes on regeneration.

Baseline and detailed evidence: `C:\Users\Admin\orca\workspaces\toto\_baseline\conditional-checkpoint-balance\20261004-052418`. Before adding this review document, Astra confirmed that git status, the tracked patch, and the untracked-file inventory matched the pre-task captures; task edits were confined to existing untracked report/source/test files. Existing user work is preserved. No commit, staging, push, or deployment occurred. The separate historical profile-validation report family was outside this correction's scope and remains untouched.

The child was explicitly dispatched on `deepseek/deepseek-v4.1-flash`; router usage metadata showed successful requests via the pinned DeepSeek provider. Astra remained the root reviewer. Both implementation turns are complete; no correction pass remains.
