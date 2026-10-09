# lucky-lady.rtp90.gc208a7e7eabe - bankroll validation

- Result: **PASS**
- Artifact hash: `80f354ce55a66ff0d96000df14f911c817f1bddb1d645b2b843226353fe02400`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Requested return: 90%
- Exact return (computed by the game's own evaluator over every reachable board): 89.9994%
- Monte Carlo (40000 complete paid rounds, seed prefix `validation:80f354ce55a66ff0d96000df14f911c817f1bddb1d645b2b843226353fe02400:1`): 91.2253% (95% CI half-width 2.0827pp)
- Proved maximum: 12.0000x - no reachable board awards 3 or more scatters, so the feature cannot run
- Hit rate: 0.1817; zero rate: 0.8184; partial-return rate: 0.0000
- Feature trigger rate: 0.0000; retrigger rate: 0.0000; feature share of return: 0.0000%

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

- Sessions: 300; horizon: 3000 paid spins
- Ruined inside the horizon: 8; censored at the horizon: 292
- Measured return over total paid wager: 90.0777% (house edge 9.9223%)
- Observed duration (paid spins): mean 2991.8, median 3000.0, p90 3000.0
- Turnover (paid spins): mean 2991.8, median 3000.0
- Ruin-before-bust quantiles (only sessions that busted): mean 2690.6, median 2845.0; a censored session contributes no bust time
- Max drawdown (units): mean 6811.8, median 6868.0, p90 9260.6, p95 9728.2

| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |
| --- | --- | --- | --- | --- |
| 100 | 1.0000 | 9783.9 | 9751.0 | 0.0000 |
| 250 | 1.0000 | 9477.1 | 9495.0 | 0.0000 |
| 500 | 1.0000 | 8928.1 | 8905.0 | 0.0000 |
| 1000 | 1.0000 | 8001.8 | 7948.0 | 0.0000 |
| 2500 | 0.9933 | n/a | n/a | n/a |

Reach / fall probabilities:

- reached 12500 units: 0.0067
- reached 15000 units: 0.0000
- reached 20000 units: 0.0000
- fell below 2000 units: 0.2400
- fell below 4000 units: 0.5733
- fell below 6000 units: 0.8933
- fell below 8000 units: 0.9833

## Checks

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 89.9994% vs requested 90% (tolerance 0.25pp)
- **PASS** `MONTE_CARLO_MATCHES_TARGET`: 40000 independent rounds measured 91.2253% against the proved 89.9994% (tolerance 6.2480pp)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: measured 91.2253% +/- 2.0827pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 12.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.899994 <= M x P(X>0) = 9.027842
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.1806 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 2.1068 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: largest single board 12.0000x, band starts at 10x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 300 complete sessions, horizon 3000 paid spins, 292 censored, 8 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 90.0777%

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that
reached the horizon is censored, never reported as ruined, and its bust time stays unknown.
