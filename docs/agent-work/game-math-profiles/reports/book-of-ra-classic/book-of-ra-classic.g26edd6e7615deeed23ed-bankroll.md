# book-of-ra-classic.g26edd6e7615deeed23ed - bankroll validation

- Result: **PASS** (evidence grade **ACTIVATION**)
- Artifact hash: `069f28094363eebee4e52d25d8c2a8c6c5c377c6e7694590d8ff08045eeb189f`
- Engine: `34ff3cb1696156e77516f146dbd0cd350f3ffe46459da97f5487140be9bf8f1d`, rules: `9c5d9e24800cbe782356ff2d0d0d1971b1624609f871f896c65ae8cf317a7814`
- Seed domains: validation `validation:069f28094363eebee4e52d25d8c2a8c6c5c377c6e7694590d8ff08045eeb189f:1`, bankroll `bankroll:069f28094363eebee4e52d25d8c2a8c6c5c377c6e7694590d8ff08045eeb189f:1`
- Monte Carlo: 1000 complete paid rounds measured 91.9667% (95% CI half-width 46.4430pp)
- Hit rate: 0.0860; zero rate: 0.9140; partial return 0.0260; break-even (X = 1): 0.0000
- Feature trigger 0.0060; retrigger 0.0000; feature share of return 38.6667%
- Largest single paid round in the cohort: 21140 units exact (211.4 PTS rounded to 4dp, session frequency 0.0833)

## Session simulation

Denomination: simulation-only centi-points (1 unit = 0.01 PTS); the live game ladder stays whole points

Ledger figures below are exact integer unit strings copied verbatim from the authoritative BigInt
accounting, and the PTS totals are their exact 1/100 scaling.
Rates, rates-of-return and quantiles are rounded statistical presentation - never an accounting input.

- Sessions: 12; horizon: 300 paid spins
- Ruined inside the horizon: 11; censored at the horizon: 1
- Measured return over total paid wager (rounded statistical presentation): 53.558704%; house edge (rounded statistical presentation): 46.441296%
- Ledger (exact units): opening 120000 + returned 129280 - wager 241380 = closing 7900 (delta 0 units, exact true)
- Exact split (units): base 92080 + feature 37200 = returned 129280
- Turnover: 241380 units exact (= 2413.8 PTS at the exact 1/100 scaling) over 1341 paid rounds
- Observed duration (paid spins): mean 111.8, median 92.0, p90 168.9 (restricted observed duration; censored sessions are not bust-time estimates)
- Drawdown (units): mean 13561.7, median 10230.0, p90 14304.0, p95 25266.0

| Checkpoint | Alive@N | Balance mean (rounded statistical) | Balance median (rounded statistical) | Ruin by N | Observable sessions |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 0.5000 | 4318.3333333333 | 980 | 0.5000 | 12 |
| 250 | 0.0833 | 1391.6666666667 | 130 | 0.9167 | 12 |

- reached 12500 units: 0.3333
- fell below 8000 units: 1.0000

## Checks

- **PASS** `ARTIFACT_IS_AN_ASSERTED_RESOLVED_SPIN_CEILING`: scope RESOLVED_SPIN, explicit ceiling flag true
- **PASS** `POLICY_TARGET_MATCHES_PAYLOAD`: payload 50% at 50x, policy 50% at 50x
- **PASS** `EXACT_RTP_MATCHES_TARGET`: fresh enumeration of every stored native window agrees with 50% within 0.000000pp
- **PASS** `MONTE_CARLO_CI_COVERS_TARGET`: 1000 rounds measured 91.9667% with a 95% half-width of 46.4430pp
- **PASS** `MONTE_CARLO_WITHIN_TOLERANCE`: measured 91.9667% vs requested 50% within the wider of the 5pp requested tolerance and the sample's 95% half-width 46.4430pp
- **PASS** `MAX_WIN_PROVEN_WITHIN_CEILING`: exhaustive per-resolution support proves 50.0000x <= 50x of the locked originating stake
- **PASS** `FEATURE_AGGREGATE_IS_NOT_THE_PER_RESOLUTION_CAP`: free spins aggregate across the feature chain without a round ceiling; the asserted bound applies to each resolution
- **PASS** `SUPPORT_COVERS_EVERY_LINE_COUNT_AND_EXPANDING_SYMBOL`: 9 line counts and 9 persistent expanding symbols enumerated
- **PASS** `FEATURE_LENGTH_IS_FINITE`: retrigger probability x 10 free spins stays below one for every line count, so no round can diverge
- **PASS** `BANKROLL_COHORT_COMPLETED`: 12 sessions at 180 units, horizon 300 paid spins
- **PASS** `BANKROLL_ACCOUNTING_EXACT`: opening + returned - wager = closing holds exactly in whole simulation units
- **PASS** `EVIDENCE_GRADE_ACTIVATION`: grade ACTIVATION: activation requires 500 rounds, 5 sessions and a 100-spin horizon; this run used 1000, 12 and 300
- **PASS** `PROFILE_IDENTITY`: engine/rules/policy/payload binding rechecked at 069f28094363eebee4e52d25d8c2a8c6c5c377c6e7694590d8ff08045eeb189f

`Alive@N` means the session could still fund the next paid stake after N completed paid spins. A checkpoint
beyond the horizon is unobserved and is reported as such, not as a zero. A session that reached the horizon
is censored; its exact bust time is unknown inside the horizon.
