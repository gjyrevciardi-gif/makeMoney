# Astra review: offline policy-to-bankroll bridge

Verdict: **NOT ACCEPTED — one report-conditioning requirement remains.** The single Flash correction pass is complete. Work is preserved uncommitted; no policy was activated.

The bridge uses the accepted weighted class selector and reachable board support, executes Lucky Lady's native `engine.playRound`, and feeds its paid/free/total resolved counts and full return into the existing `simulateCohort`. No parallel bankroll loop was introduced. The reviewed source passes no identity, balance, or player-history input into outcome selection. The accepted accounting, selector, runtime adapter, distribution adapter and RTP50 artifact hashes remain unchanged.

## Verified evidence

- Worker focused command (backend directory): `node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand test/payout-policy-bankroll.spec.ts test/lucky-lady.session-source.spec.ts`: **11 passed**. No full suite, browser or database integration run.
- Six offline policies, 660 sessions, horizon 10,000 paid spins; final artifacts contain **3,199,518 paid spins** and **41,880 free spins**. Seeds and complete session configurations are recorded per policy.
- Astra independently checked all six JSON reports: starting balance 10,000 centi-PTS, wager 20 centi-PTS, exact opening + return - wager = closing, paid + free = total resolved, class counts = paid spins, zero native-class mismatches, zero class deviations beyond three standard errors, and paid/free maxima within their configured caps. Approximate sampling intervals are not activation-grade validation.
- LOSS100 independently produced exactly 500 paid spins, 100 PTS turnover, zero return and zero closing balance per session. BREAK_EVEN100 artifacts retain 100 PTS and report horizon censoring. House result is wager minus all payouts; feature payouts recycle into bankroll without a second wager.
- The feature fixture reaches a 50x single free-spin payout and a 1,351x feature aggregate; the aggregate is reported separately and is not a RESOLVED_SPIN violation. Retrigger incidence is explicitly per paid round with at least one retrigger.
- An independent deterministic streak probe with session longest streaks `[2,3,0]` returns R-7 P99 = 2.98 and pooled run mean = 2. Paid-event streaks exclude free resolutions and distinguish 0x from <=1x.
- The dense accepted RTP50 profile is explicitly unsupported by this bounded support index. Its historical validation is not presented as a new policy-session run.

## Remaining blocker: balances for sessions that still exist

The user requests checkpoint balance distributions where the session still exists. The new report currently copies the accepted simulator's *whole-cohort, terminal-balance-carried-forward* summaries. This produces balance observations for sessions already ruined before the checkpoint. Labeling that convention does not supply the requested conditional distribution.

Astra's independent real-path LOSS100 probe used two sessions, a 1,000-spin horizon, 100 PTS starting balance and 0.20 PTS wager:

| Metric | Result |
| --- | ---: |
| Paid spins in each session | 500 |
| Sessions reaching 1,000 paid spins | 0 |
| Reported balance observations at 1,000 | 2 |
| Reported mean at 1,000 | 0 |

The requested checkpoint population is empty, so its count should be zero and its balance quantiles unavailable. The carried-forward cohort distribution may remain as a separately named supplementary metric.

The next bounded correction belongs only in the new report module and its focused tests/artifacts: derive a clearly defined eligible checkpoint population from existing session records, then render its denominator and quantiles. Do not change accepted bankroll accounting or survival/ruin semantics. No second implementation correction was requested in this phase.
