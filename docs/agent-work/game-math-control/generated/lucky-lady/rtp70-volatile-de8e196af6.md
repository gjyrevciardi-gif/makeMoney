# lucky-lady.gen.volatile.rtp70.de8e196af6 - generated payout policy

- Status: **VALIDATED** (activation: **false**, testOnly: **true**)
- Generated at: 2026-01-01T00:00:00.000Z
- Request: `{"targetRtpPercent":"70","objective":"VOLATILE"}`
- Normalized request: target 70%, objective VOLATILE, granularity 1000000, tolerance 0.01pp
- Solver: payout-policy-solver.v1; method EXACT_TWO_CLASS; support LOSS+MEDIUM; enumerated 15 pairs / 20 triples
- Request hash: `036afb8f36ff19dbd96c4554c48be8d3bbd91f852d311c6dbb5bd4e0279e1072`
- Policy: `lucky-lady.gen.volatile.rtp70.de8e196af6` hash `575a8d19d51e1a0f637eef3e2151cb3884d693fd34e5191e5aeb2a7a66490427`
- Model: `lucky-lady.model.bounded-generator.v1` hash `4d66174ec81e2f9ac4701de1f54b98ac96e065d968f422e76036f3c001915bc9`
- Declared model return under its own weights: 1763.997730%; feature trigger probability 0.00099402; expected feature spins 15.2270; feature chain diverges: false
- Unreachable classes in the declared model: BREAK_EVEN, BIG, MAX

## Expected return

- Expected (exact support): 69.999604%
- Exact absolute error against the request: 0.000396pp (tolerance 0.01pp)
- Measured over the bounded sample: 68.891959% (standard error 0.9186%; 95% interval 67.092% - 70.692%)
- Statistical verdict: **PASS** (|measured - expected| = 1.1076pp, tolerance 3 x standard error + 0.5pp)

## Class weights

| Class | Weight (grid units) | Configured share | Proved expectation |
| --- | ---: | ---: | ---: |
| LOSS | 940274 | 94.0274% | 0.000000 |
| PARTIAL_LOW | 0 | 0.0000% | 0.300050 |
| PARTIAL_HIGH | 10000 | 1.0000% | 0.800000 |
| BREAK_EVEN | 0 | 0.0000% | unreachable |
| SMALL | 10000 | 1.0000% | 1.750749 |
| MEDIUM | 39726 | 3.9726% | 16.978516 |
| BIG | 0 | 0.0000% | unreachable |
| MAX | 0 | 0.0000% | unreachable |
| FEATURE_TRIGGER | 0 | 0.0000% | 732.683481 |

## Acceptance checks

- **PASS** `ACCEPTED_POLICY_VALIDATION`: the accepted distribution-policy validator accepted the generated policy
- **PASS** `SUPPORT_PROOF_UNDER_FINAL_WEIGHTS`: the accepted support builder proved 108 boards and the per-resolution ceiling
- **PASS** `WEIGHTS_SUM_TO_GRANULARITY`: weights sum to 1000000 of the 1000000-unit grid
- **PASS** `WEIGHTS_NON_NEGATIVE_INTEGERS`: every weight is a non-negative safe integer
- **PASS** `ONLY_REACHABLE_CLASSES_CARRY_WEIGHT`: unreachable classes carry zero weight (BREAK_EVEN, BIG, MAX)
- **PASS** `WEIGHTED_CLASSES_HAVE_PROVED_EXPECTATION`: every weighted class has reachable members and a proved expectation
- **PASS** `MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING`: proved per-resolution max 50x (paid 20x, free 50x) vs the declared 50x ceiling; the feature aggregate is deliberately uncapped
- **PASS** `MAX_WIN_CAP_IS_EXACT_ON_THE_SIMULATION_GRID`: cap 50x x 20 stake units = 1000 exact simulation units
- **PASS** `EXPECTED_RTP_MATCHES_TARGET`: exact expected 69.999604% vs requested 70% (exact absolute error 0.000396pp, tolerance 0.01pp)
- **PASS** `TARGET_ZERO_IS_A_PROVED_ZERO_RETURN_POLICY`: not applicable (target is not 0%)
- **PASS** `REQUESTED_MINIMUM_WEIGHTS_HELD`: minimum weights held: {"LOSS":10000,"PARTIAL_HIGH":10000,"SMALL":10000}
- **PASS** `FEATURE_EXPECTATION_PROVED_OR_ABSENT`: FEATURE_TRIGGER expectation 732.683481 (paid 19.988012, feature 712.695469)
- **PASS** `POLICY_HASH_IS_CANONICAL`: policy hash 575a8d19d51e1a0f637eef3e2151cb3884d693fd34e5191e5aeb2a7a66490427 is stable across a serialization round trip
- **PASS** `POSITIVE_PROFIT_WEIGHT_WHEN_TARGET_POSITIVE`: 49726 grid units on classes with a proved expectation above 1x (floor 10000)
- **PASS** `POSITIVE_LOSS_WEIGHT_WHEN_TARGET_POSITIVE`: LOSS weight 940274 units

## Pipeline stages

- GENERATING: request 036afb8f36ff accepted; objective VOLATILE
- GENERATED: solved 1000000 grid units across LOSS+MEDIUM (EXACT_TWO_CLASS)
- VALIDATING: 15 acceptance checks
- VALIDATED: every analytical check passed; activation is not part of this pipeline

## Bankroll sample (accepted simulator, simulation-only denomination)

- Sessions: 80; horizon: 5000 paid spins; censored 0; ruined 80
- Seeds: prefix `generated:rtp70-volatile:v1` (generated:rtp70-volatile:v1:0 .. generated:rtp70-volatile:v1:79)
- Initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units)
- Spins: 128461 paid + 0 free = 128461 resolved
- Ledger identity (exact units): opening 800000 + returned 1769986 - wager 2569220 = closing 766 (exact: true)
- Paid spins per session: mean 1605.8, median 1516.0, p90 2205.6
- Turnover (paid only): mean 321.1525 PTS, median 303.2 PTS, p90 441.12 PTS
- House per session: mean wager 321.1525 PTS, mean payout 221.2483 PTS, mean net 99.9042 PTS
- Drawdown (units): mean 10347.7, median 10147.0, p90 11143.6, p95 11545.3
- Paid-event full loss 94.11%; hit 5.89%; partial 1.00%; profitable 4.89%
- Feature triggered 0.0000% of paid rounds; retriggered 0.0000%; native class mismatches 0
- Max observed paid resolved spin 340 units; free resolved spin 0 units (cap 1000); feature aggregate 0 units (deliberately uncapped)

| N | Alive@N (observed) | Balance mean | Ruin by N | Ruin observed |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100.00% (80) | 9395.0 | 0.00% | 80 |
| 250 | 100.00% (80) | 8470.7 | 0.00% | 80 |
| 500 | 100.00% (80) | 6824.1 | 0.00% | 80 |
| 1000 | 93.75% (80) | 3836.9 | 6.25% | 80 |
| 2500 | 2.50% (80) | 3530.0 | 97.50% | 80 |
| 5000 | 0.00% (80) | n/a | 100.00% | 80 |
| 10000 | unobserved (0) | not requested | unknown | 0 |

- FULL_LOSS dry spell: pooled mean 16.73 (denominator 7228 runs); longest per session mean 81.21, p90 99.1, p99 112.6
- NON_PROFITABLE dry spell: pooled mean 20.09 (denominator 6081 runs); longest per session mean 96.46, p90 124.0, p99 155.8

- reached 125 PTS: 0.00%
- reached 150 PTS: 0.00%
- reached 200 PTS: 0.00%
- fell below 20 PTS: 100.00%
- fell below 40 PTS: 100.00%
- fell below 60 PTS: 100.00%
- fell below 80 PTS: 100.00%

## Warnings

- Offline generator evidence: activation is never part of this pipeline; the candidate stays a reviewable artifact.
- The bankroll sample is bounded and predeclared; the seed prefix and sample size are recorded, and no seed is searched.
- Session proportions carry Wilson 95% intervals limited by the session count; the RTP interval is a normal approximation over observed paid rounds while the number of rounds is bankroll-dependent (optional stopping), so it is approximate.
