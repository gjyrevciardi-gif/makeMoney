# lucky-lady.rtp77p70.g8a3b9f80ab74 - bankroll validation

- Result: **PASS**
- Artifact hash: `97baaf766e55827c7b158d96b7d5c236d2327417b1e28c1595f31fd35768a31a`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Requested return: 77.7%
- Exact return (computed by the game's own evaluator over every reachable board): 77.6996%
- Monte Carlo (40000 complete paid rounds, seed prefix `validation:97baaf766e55827c7b158d96b7d5c236d2327417b1e28c1595f31fd35768a31a:1`): 77.7030% (95% CI half-width 1.9324pp)
- Proved maximum: 12.0000x - no reachable board awards 3 or more scatters, so the feature cannot run
- Hit rate: 0.1574; zero rate: 0.8426; partial-return rate: 0.0000
- Feature trigger rate: 0.0000; retrigger rate: 0.0000; feature share of return: 0.0000%

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

- Sessions: 300; horizon: 3000 paid spins
- Ruined inside the horizon: 284; censored at the horizon: 16
- Measured return over total paid wager: 77.7946% (house edge 22.2054%)
- Observed duration (paid spins): mean 2233.0, median 2212.0, p90 2845.2
- Turnover (paid spins): mean 2233.0, median 2212.0
- Ruin-before-bust quantiles (only sessions that busted): mean 2189.8, median 2183.0; a censored session contributes no bust time
- Max drawdown (units): mean 10106.9, median 10085.0, p90 10396.0, p95 10480.7

| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |
| --- | --- | --- | --- | --- |
| 100 | 1.0000 | 9565.6 | 9536.0 | 0.0000 |
| 250 | 1.0000 | 8918.5 | 8905.0 | 0.0000 |
| 500 | 1.0000 | 7812.7 | 7708.0 | 0.0000 |
| 1000 | 1.0000 | 5578.4 | 5631.0 | 0.0000 |
| 2500 | 0.2800 | n/a | n/a | n/a |

Reach / fall probabilities:

- reached 12500 units: 0.0000
- reached 15000 units: 0.0000
- reached 20000 units: 0.0000
- fell below 2000 units: 0.9867
- fell below 4000 units: 1.0000
- fell below 6000 units: 1.0000
- fell below 8000 units: 1.0000

## Checks

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 77.6996% vs requested 77.7% (tolerance 0.25pp)
- **PASS** `MONTE_CARLO_MATCHES_TARGET`: 40000 independent rounds measured 77.7030% against the proved 77.6996% (tolerance 5.7972pp)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: measured 77.7030% +/- 1.9324pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 12.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.776996 <= M x P(X>0) = 7.849019
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.1570 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 1.9731 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: largest single board 12.0000x, band starts at 10x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 300 complete sessions, horizon 3000 paid spins, 16 censored, 284 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 77.7946%

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that
reached the horizon is censored, never reported as ruined, and its bust time stays unknown.
