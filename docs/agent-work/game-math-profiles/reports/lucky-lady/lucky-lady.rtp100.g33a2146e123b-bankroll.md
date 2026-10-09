# lucky-lady.rtp100.g33a2146e123b - bankroll validation

- Result: **PASS**
- Artifact hash: `b47dc10b363682cf0c6d064262b504c93e5a5ea17117a7643fd3ba60fb759658`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Requested return: 100%
- Exact return (computed by the game's own evaluator over every reachable board): 100.0007%
- Monte Carlo (40000 complete paid rounds, seed prefix `validation:b47dc10b363682cf0c6d064262b504c93e5a5ea17117a7643fd3ba60fb759658:1`): 100.2177% (95% CI half-width 2.1585pp)
- Proved maximum: 12.0000x - no reachable board awards 3 or more scatters, so the feature cannot run
- Hit rate: 0.2008; zero rate: 0.7992; partial-return rate: 0.0000
- Feature trigger rate: 0.0000; retrigger rate: 0.0000; feature share of return: 0.0000%

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

- Sessions: 300; horizon: 3000 paid spins
- Ruined inside the horizon: 0; censored at the horizon: 300
- Measured return over total paid wager: 100.2293% (house edge -0.2293%)
- Observed duration (paid spins): mean 3000.0, median 3000.0, p90 3000.0
- Turnover (paid spins): mean 3000.0, median 3000.0
- Ruin-before-bust quantiles (only sessions that busted): mean n/a, median n/a; a censored session contributes no bust time
- Max drawdown (units): mean 2987.4, median 2708.0, p90 4906.8, p95 5304.1

| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |
| --- | --- | --- | --- | --- |
| 100 | 1.0000 | 10030.6 | 10018.0 | 0.0000 |
| 250 | 1.0000 | 10040.2 | 10044.0 | 0.0000 |
| 500 | 1.0000 | 10053.3 | 10005.0 | 0.0000 |
| 1000 | 1.0000 | 10001.8 | 9968.0 | 0.0000 |
| 2500 | 1.0000 | n/a | n/a | n/a |

Reach / fall probabilities:

- reached 12500 units: 0.3200
- reached 15000 units: 0.0767
- reached 20000 units: 0.0000
- fell below 2000 units: 0.0000
- fell below 4000 units: 0.0033
- fell below 6000 units: 0.1167
- fell below 8000 units: 0.4033

## Checks

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 100.0007% vs requested 100% (tolerance 0.25pp)
- **PASS** `MONTE_CARLO_MATCHES_TARGET`: 40000 independent rounds measured 100.2177% against the proved 100.0007% (tolerance 6.4754pp)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: measured 100.2177% +/- 2.1585pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 12.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 1.000007 <= M x P(X>0) = 9.972911
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.1995 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 2.2067 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: largest single board 12.0000x, band starts at 10x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 300 complete sessions, horizon 3000 paid spins, 300 censored, 0 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 100.2293%

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that
reached the horizon is censored, never reported as ruined, and its bust time stays unknown.
