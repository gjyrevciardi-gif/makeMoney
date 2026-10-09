# lucky-lady.rtp10.g7ce56de27a47 - bankroll validation

- Result: **PASS**
- Artifact hash: `64ab0c07abe642be7d0c402fc63ecff5d66b7c271683cca61923688df853a03b`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Requested return: 10%
- Exact return (computed by the game's own evaluator over every reachable board): 10.0003%
- Monte Carlo (40000 complete paid rounds, seed prefix `validation:64ab0c07abe642be7d0c402fc63ecff5d66b7c271683cca61923688df853a03b:1`): 9.8360% (95% CI half-width 0.9966pp)
- Proved maximum: 20.8000x - no reachable board awards 3 or more scatters, so the feature cannot run
- Hit rate: 0.0097; zero rate: 0.9902; partial-return rate: 0.0000
- Feature trigger rate: 0.0000; retrigger rate: 0.0000; feature share of return: 0.0000%

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

- Sessions: 300; horizon: 3000 paid spins
- Ruined inside the horizon: 300; censored at the horizon: 0
- Measured return over total paid wager: 10.1175% (house edge 89.8825%)
- Observed duration (paid spins): mean 555.9, median 552.0, p90 590.1
- Turnover (paid spins): mean 555.9, median 552.0
- Ruin-before-bust quantiles (only sessions that busted): mean 555.9, median 552.0; a censored session contributes no bust time
- Max drawdown (units): mean 10005.2, median 9992.0, p90 10013.2, p95 10100.4

| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |
| --- | --- | --- | --- | --- |
| 100 | 1.0000 | 8191.1 | 8156.0 | 0.0000 |
| 250 | 1.0000 | 5515.2 | 5468.0 | 0.0000 |
| 500 | 0.9967 | 1041.1 | 964.0 | 0.0033 |
| 1000 | 0.0000 | 7.7 | 8.0 | 1.0000 |
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

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 10.0003% vs requested 10% (tolerance 0.25pp)
- **PASS** `MONTE_CARLO_MATCHES_TARGET`: 40000 independent rounds measured 9.8360% against the proved 10.0003% (tolerance 2.9898pp)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: measured 9.8360% +/- 0.9966pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 20.8000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.100003 <= M x P(X>0) = 0.493576
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.0099 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 1.0285 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: largest single board 20.8000x, band starts at 10x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 300 complete sessions, horizon 3000 paid spins, 0 censored, 300 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 10.1175%

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that
reached the horizon is censored, never reported as ruined, and its bust time stays unknown.
