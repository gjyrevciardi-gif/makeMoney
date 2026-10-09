# lucky-lady.rtp95.g5095154ce856 - bankroll validation

- Result: **PASS**
- Artifact hash: `08850cbef535c0ec459fd7234bbd8fe68df49cd8545d2c11cb8d567122ef5055`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Requested return: 95%
- Exact return (computed by the game's own evaluator over every reachable board): 95.0000%
- Monte Carlo (40000 complete paid rounds, seed prefix `validation:08850cbef535c0ec459fd7234bbd8fe68df49cd8545d2c11cb8d567122ef5055:1`): 93.6782% (95% CI half-width 2.1036pp)
- Proved maximum: 12.0000x - no reachable board awards 3 or more scatters, so the feature cannot run
- Hit rate: 0.1870; zero rate: 0.8129; partial-return rate: 0.0000
- Feature trigger rate: 0.0000; retrigger rate: 0.0000; feature share of return: 0.0000%

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

- Sessions: 300; horizon: 3000 paid spins
- Ruined inside the horizon: 0; censored at the horizon: 300
- Measured return over total paid wager: 95.2906% (house edge 4.7094%)
- Observed duration (paid spins): mean 3000.0, median 3000.0, p90 3000.0
- Turnover (paid spins): mean 3000.0, median 3000.0
- Ruin-before-bust quantiles (only sessions that busted): mean n/a, median n/a; a censored session contributes no bust time
- Max drawdown (units): mean 4465.0, median 4294.0, p90 6605.6, p95 7254.0

| Checkpoint (paid spins) | Alive@N | Balance mean | Balance median | Ruin by N |
| --- | --- | --- | --- | --- |
| 100 | 1.0000 | 9968.0 | 9954.0 | 0.0000 |
| 250 | 1.0000 | 9849.7 | 9858.0 | 0.0000 |
| 500 | 1.0000 | 9615.1 | 9667.0 | 0.0000 |
| 1000 | 1.0000 | 9075.4 | 9076.0 | 0.0000 |
| 2500 | 1.0000 | n/a | n/a | n/a |

Reach / fall probabilities:

- reached 12500 units: 0.0400
- reached 15000 units: 0.0000
- reached 20000 units: 0.0000
- fell below 2000 units: 0.0200
- fell below 4000 units: 0.1167
- fell below 6000 units: 0.3967
- fell below 8000 units: 0.7867

## Checks

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 95.0000% vs requested 95% (tolerance 0.25pp)
- **PASS** `MONTE_CARLO_MATCHES_TARGET`: 40000 independent rounds measured 93.6782% against the proved 95.0000% (tolerance 6.3108pp)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: measured 93.6782% +/- 2.1036pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 12.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.950000 <= M x P(X>0) = 9.501890
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.1900 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 2.1577 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: largest single board 12.0000x, band starts at 10x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 300 complete sessions, horizon 3000 paid spins, 300 censored, 0 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 95.2906%

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A session that
reached the horizon is censored, never reported as ruined, and its bust time stays unknown.
