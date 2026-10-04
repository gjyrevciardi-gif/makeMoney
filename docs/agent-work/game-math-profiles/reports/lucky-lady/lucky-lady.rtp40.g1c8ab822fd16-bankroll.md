# lucky-lady.rtp40.g1c8ab822fd16 - bankroll validation

- Result: **PASS** (evidence grade **ACTIVATION**)
- Artifact hash: `9ea06a6599738b0e9fd5734d4ecc01c59b503aa6a25809b89de7f1a7cd084b90`
- Engine: `0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules: `4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`
- Seed domains: validation `validation:9ea06a6599738b0e9fd5734d4ecc01c59b503aa6a25809b89de7f1a7cd084b90:1`, bankroll `bankroll:9ea06a6599738b0e9fd5734d4ecc01c59b503aa6a25809b89de7f1a7cd084b90:1`
- Monte Carlo: 1000 complete paid rounds measured 46.3700% (95% CI half-width 9.8706pp)
- Hit rate: 0.0900; zero rate: 0.9100; partial return 0.0000; break-even (X = 1): 0.0000
- Feature trigger 0.0000; retrigger 0.0000; feature share of return 0.0000%
- Largest single paid round in the cohort: 240 units exact (2.4 PTS rounded to 4dp, session frequency 0.0833)

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

Ledger figures below are exact integer unit strings copied verbatim from the authoritative BigInt
accounting, and the PTS totals are their exact 1/100 scaling.
Rates, rates-of-return and quantiles are rounded statistical presentation - never an accounting input.

- Sessions: 12; horizon: 300 paid spins
- Ruined inside the horizon: 0; censored at the horizon: 12
- Measured return over total paid wager (rounded statistical presentation): 38.538889%; house edge (rounded statistical presentation): 61.461111%
- Ledger (exact units): opening 120000 + returned 27748 - wager 72000 = closing 75748 (delta 0 units, exact true)
- Exact split (units): base 27748 + feature 0 = returned 27748
- Turnover: 72000 units exact (= 720 PTS at the exact 1/100 scaling) over 3600 paid rounds
- Observed duration (paid spins): mean 300.0, median 300.0, p90 300.0 (restricted observed duration; censored sessions are not bust-time estimates)
- Drawdown (units): mean 3734.0, median 3704.0, p90 4523.4, p95 4595.3

| Checkpoint | Alive@N | Balance mean (rounded statistical) | Balance median (rounded statistical) | Ruin by N | Observable sessions |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1.0000 | 8633.6666666667 | 8652 | 0.0000 | 12 |
| 250 | 1.0000 | 6831.1666666667 | 6953 | 0.0000 | 12 |

- reached 12500 units: 0.0000
- fell below 8000 units: 1.0000

## Checks

- **PASS** `EXACT_RTP_MATCHES_TARGET`: exact 39.9997% vs requested 40% (tolerance 0.5pp)
- **PASS** `MONTE_CARLO_CONSISTENT_WITH_EXACT`: 1000 independent rounds measured 46.3700% against the proved 39.9997%; 3-sigma consistency tolerance 29.6118pp (this is a stated z-multiplier, not the confidence interval)
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: 95% interval 46.3700% +/- 9.8706pp must contain the requested 40%
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: proved ceiling 12.0000x vs requested 50x; no reachable board awards 3 or more scatters, so the feature cannot run
- **PASS** `RTP_WITHIN_BOUND_TIMES_HIT_RATE`: E[X] = 0.399997 <= M x P(X>0) = 4.125115
- **PASS** `OPTIONAL_GAMBLE_SCOPE_STATED`: ceiling applies to the complete paid round and explicitly excludes the optional gamble decision
- **PASS** `HIT_RATE_AUTO`: observed hit rate 0.0825 (AUTO, not constrained)
- **PASS** `PARTIAL_RETURN_TIER`: partial-return share 0.0000 requested LOW (0..0.15)
- **PASS** `VOLATILITY_TIER`: return standard deviation 1.4509 requested MED (1..3)
- **PASS** `BIG_WIN_BAND_REACHABLE`: 0.007483% of paid boards land inside the requested [10x, 50x] band; largest board 12.0000x
- **PASS** `FEATURE_CONTRIBUTION`: feature contributed 0.0000% of observed return, requested 0..60%
- **PASS** `BANKROLL_COHORT_COMPLETED`: 12 complete sessions, horizon 300 paid spins, 12 censored, 0 busted
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: total return / total paid wager = 38.538889% (rounded presentation); opening 120000 + returned 27748 - wager 72000 = closing 75748 (delta 0)
- **PASS** `EVIDENCE_GRADE_ACTIVATION`: grade ACTIVATION: activation requires at least 500 Monte Carlo rounds, 5 sessions and a horizon of 100 paid spins; this run used 1000 rounds, 12 sessions, horizon 300

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A checkpoint
beyond the horizon is unobserved and is reported as such, not as a zero. A session that reached the horizon
is censored; its exact bust time is unknown inside the horizon.
