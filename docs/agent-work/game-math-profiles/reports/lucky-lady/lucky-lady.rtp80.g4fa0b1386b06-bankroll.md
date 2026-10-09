# lucky-lady.rtp80.g4fa0b1386b06 - bankroll validation

- Result: **PASS** (evidence grade **ACTIVATION**)
- Artifact hash: `b0968a068b6e054e7ddec091cf184dfb4f0d6c6ae0f929e60a1fcfba8c4eadcb`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Seed domains: validation `validation:b0968a068b6e054e7ddec091cf184dfb4f0d6c6ae0f929e60a1fcfba8c4eadcb:1`, bankroll `bankroll:b0968a068b6e054e7ddec091cf184dfb4f0d6c6ae0f929e60a1fcfba8c4eadcb:1`
- Monte Carlo: 1000 complete paid rounds measured 76.7400% (95% CI half-width 11.7470pp)
- Hit rate: 0.1640; zero rate: 0.8360; partial return 0.0000; break-even (X = 1): 0.0000
- Feature trigger 0.0000; retrigger 0.0000; feature share of return 0.0000%
- Largest single paid round in the cohort: 176 units exact (1.76 PTS rounded to 4dp, session frequency 1.0000)

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

Ledger figures below are exact integer unit strings copied verbatim from the authoritative BigInt
accounting, and the PTS totals are their exact 1/100 scaling.
Rates, rates-of-return and quantiles are rounded statistical presentation - never an accounting input.

- Sessions: 12; horizon: 300 paid spins
- Ruined inside the horizon: 0; censored at the horizon: 12
- Measured return over total paid wager (rounded statistical presentation): 78.613889%; house edge (rounded statistical presentation): 21.386111%
- Ledger (exact units): opening 120000 + returned 56602 - wager 72000 = closing 104602 (delta 0 units, exact true)
- Exact split (units): base 56602 + feature 0 = returned 56602
- Turnover: 72000 units exact (= 720 PTS at the exact 1/100 scaling) over 3600 paid rounds
- Observed duration (paid spins): mean 300.0, median 300.0, p90 300.0 (restricted observed duration; censored sessions are not bust-time estimates)
- Drawdown (units): mean 1636.5, median 1764.0, p90 1875.0, p95 2013.7

| Checkpoint | Alive@N | Balance mean (rounded statistical) | Balance median (rounded statistical) | Ruin by N | Observable sessions |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1.0000 | 9728.8333333333 | 9797 | 0.0000 | 12 |
| 250 | 1.0000 | 9023.5 | 8949 | 0.0000 | 12 |

- reached 12500 units: 0.0000
- fell below 8000 units: 0.0833

## Checks

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 80.0006% vs requested 80% (tolerance 0.5pp)
- **PASS** `MONTE_CARLO_CONSISTENT_WITH_EXACT`: 1000 independent rounds measured 76.7400% against the proved 80.0006%; 3-sigma consistency tolerance 35.2409pp (this is a stated z-multiplier, not the confidence interval)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: 95% interval 76.7400% +/- 11.7470pp must contain the requested 80%
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 12.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.800006 <= M x P(X>0) = 8.070921
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.1614 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 1.9992 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: 0.059820% of paid boards land inside the requested [10x, 50x] band; largest board 12.0000x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 12 complete sessions, horizon 300 paid spins, 12 censored, 0 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 78.613889% (rounded presentation); opening 120000 + returned 56602 - wager 72000 = closing 104602 (delta 0)
- **PASS** `EVIDENCE_GRADE_ACTIVATION`: grade ACTIVATION: activation requires at least 500 Monte Carlo rounds, 5 sessions and a horizon of 100 paid spins; this run used 1000 rounds, 12 sessions, horizon 300

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A checkpoint
beyond the horizon is unobserved and is reported as such, not as a zero. A session that reached the horizon
is censored; its exact bust time is unknown inside the horizon.
