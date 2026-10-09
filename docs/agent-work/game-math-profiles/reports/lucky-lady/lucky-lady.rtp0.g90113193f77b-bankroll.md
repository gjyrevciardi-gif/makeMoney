# lucky-lady.rtp0.g90113193f77b - bankroll validation

- Result: **PASS**
- Artifact hash: `f32ca91a62fd4aaca829434fc9ce5cc9f84254e3a23ae40b5a532c050dce0759`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Requested return: 0%
- Exact return (computed by the game's own evaluator over every reachable board): 0.0000%
- Monte Carlo (40000 complete paid rounds, seed prefix `validation:f32ca91a62fd4aaca829434fc9ce5cc9f84254e3a23ae40b5a532c050dce0759:1`): 0.0000% (95% CI half-width 0.0000pp)
- Proved maximum: 0.0000x - no reachable board awards 3 or more scatters, so the feature cannot run
- Hit rate: 0.0000; zero rate: 1.0000; partial-return rate: 0.0000
- Feature trigger rate: 0.0000; retrigger rate: 0.0000; feature share of return: 0.0000%

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

- Sessions: 300; horizon: 3000 paid spins
- Ruined inside the horizon: 300; censored at the horizon: 0
- Measured return over total paid wager: 0.0000% (house edge 100.0000%)
- Observed duration (paid spins): mean 500.0, median 500.0, p90 500.0
- Turnover (paid spins): mean 500.0, median 500.0
- Ruin-before-bust quantiles (only sessions that busted): mean 500.0, median 500.0; a censored session contributes no bust time
- Max drawdown (units): mean 10000.0, median 10000.0, p90 10000.0, p95 10000.0

| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |
| --- | --- | --- | --- | --- |
| 100 | 1.0000 | 8000.0 | 8000.0 | 0.0000 |
| 250 | 1.0000 | 5000.0 | 5000.0 | 0.0000 |
| 500 | 0.0000 | 0.0 | 0.0 | 1.0000 |
| 1000 | 0.0000 | 0.0 | 0.0 | 1.0000 |
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

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 0.0000% vs requested 0% (tolerance 0.25pp)
- **PASS** `MONTE_CARLO_MATCHES_TARGET`: 40000 independent rounds measured 0.0000% against the proved 0.0000% (tolerance 0.2500pp)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: measured 0.0000% +/- 0.0000pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 0.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.000000 <= M x P(X>0) = 0.000000
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.0000 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 0.0000 requested LOW (0..1)
- **PASS** `BIG_WIN_BAND_REACHABLE`: a proved zero-return profile has no reachable paying outcome, so no win band applies
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 300 complete sessions, horizon 3000 paid spins, 0 censored, 300 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 0.0000%

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that
reached the horizon is censored, never reported as ruined, and its bust time stays unknown.
