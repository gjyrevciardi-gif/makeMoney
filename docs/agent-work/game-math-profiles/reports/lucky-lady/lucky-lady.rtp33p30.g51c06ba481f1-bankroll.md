# lucky-lady.rtp33p30.g51c06ba481f1 - bankroll validation

- Result: **PASS**
- Artifact hash: `61b0109227fa70aeae566b1bff0969e8bf37a5db149ee5009cfd779612d072a7`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Requested return: 33.3%
- Exact return (computed by the game's own evaluator over every reachable board): 33.2993%
- Monte Carlo (40000 complete paid rounds, seed prefix `validation:61b0109227fa70aeae566b1bff0969e8bf37a5db149ee5009cfd779612d072a7:1`): 33.8522% (95% CI half-width 1.3110pp)
- Proved maximum: 12.0000x - no reachable board awards 3 or more scatters, so the feature cannot run
- Hit rate: 0.0703; zero rate: 0.9297; partial-return rate: 0.0000
- Feature trigger rate: 0.0000; retrigger rate: 0.0000; feature share of return: 0.0000%

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

- Sessions: 300; horizon: 3000 paid spins
- Ruined inside the horizon: 300; censored at the horizon: 0
- Measured return over total paid wager: 33.2273% (house edge 66.7727%)
- Observed duration (paid spins): mean 748.1, median 744.5, p90 819.2
- Turnover (paid spins): mean 748.1, median 744.5
- Ruin-before-bust quantiles (only sessions that busted): mean 748.1, median 744.5; a censored session contributes no bust time
- Max drawdown (units): mean 10016.1, median 9996.0, p90 10096.0, p95 10112.2

| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |
| --- | --- | --- | --- | --- |
| 100 | 1.0000 | 8654.3 | 8626.0 | 0.0000 |
| 250 | 1.0000 | 6629.6 | 6627.0 | 0.0000 |
| 500 | 1.0000 | 3284.6 | 3293.0 | 0.0000 |
| 1000 | 0.0000 | 9.7 | 10.0 | 1.0000 |
| 2500 | 0.0000 | n/a | n/a | n/a |

Reach / fall probabilities:

- reached 12500 units: 0.0000
- reached 15000 units: 0.0000
- reached 20000 units: 0.0000
- fell below 2000 units: 1.0000
- fell below 4000 units: 1.0000
- fell below 6000 units: 1.0000
- fell below 8000 units: 1.0000

## Checks

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 33.2993% vs requested 33.3% (tolerance 0.25pp)
- **PASS** `MONTE_CARLO_MATCHES_TARGET`: 40000 independent rounds measured 33.8522% against the proved 33.2993% (tolerance 3.9331pp)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: measured 33.8522% +/- 1.3110pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 12.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.332993 <= M x P(X>0) = 3.446277
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.0689 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 1.3297 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: largest single board 12.0000x, band starts at 10x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 300 complete sessions, horizon 3000 paid spins, 0 censored, 300 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 33.2273%

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that
reached the horizon is censored, never reported as ruined, and its bust time stays unknown.
