# lucky-lady.gen.retention.rtp70.20c7011317 - generated payout policy

- Status: **VALIDATED** (activation: **false**, testOnly: **true**)
- Generated at: 2026-10-04T15:52:40.916Z
- Request: `{"gameId":"lucky-lady","targetRtp":70,"maxWinMultiplier":20,"pacing":"RETENTION"}`
- Normalized request: target 70%, objective RETENTION, granularity 1000000, tolerance 0.01pp
- Solver: payout-policy-solver.v1.1; method EXACT_TWO_CLASS; support PARTIAL_LOW+SMALL; enumerated 10 pairs / 10 triples
- Request hash: `1c0abfbb1214d919da9b30424dd59abc2fe03495f29f2e057b921f5bd9defd38`
- Policy: `lucky-lady.gen.retention.rtp70.20c7011317` hash `1ac833cd4892eb4a4238b2286d8660e7d39e11c3c0ac8150e2c216d0be0baea5`
- Model: `lucky-lady.model.bounded-generator.max20.v1` hash `2f5d1b8e5759e0dfb2a8b36749c3669c2fbd679b88dbc888708f3635aa8377eb`
- Declared model return under its own weights: 74.074074%; feature trigger probability 0.00000000; expected feature spins 15.0000; feature chain diverges: false
- Unreachable classes in the declared model: BREAK_EVEN, BIG, MAX, FEATURE_TRIGGER

## Expected return

- Expected (exact support): 70.00002%
- Exact absolute error against the request: 0.00002pp (tolerance 0.01pp)
- Measured over the bounded sample: 70.250015% (standard error 0.2200%; 95% interval 69.819% - 70.681%)
- Statistical verdict: **PASS** (|measured - expected| = 0.2500pp, tolerance 3 x standard error + 0.5pp)

## Class weights

| Class | Weight (grid units) | Configured share | Proved expectation |
| --- | ---: | ---: | ---: |
| LOSS | 10000 | 1.0000% | 0.000000 |
| PARTIAL_LOW | 703611 | 70.3611% | 0.200000 |
| PARTIAL_HIGH | 10000 | 1.0000% | 0.650000 |
| BREAK_EVEN | 0 | 0.0000% | unreachable |
| SMALL | 276389 | 27.6389% | 2.000000 |
| MEDIUM | 0 | 0.0000% | 5.400000 |
| BIG | 0 | 0.0000% | unreachable |
| MAX | 0 | 0.0000% | unreachable |
| FEATURE_TRIGGER | 0 | 0.0000% | unreachable |

## Acceptance checks

- **PASS** `ACCEPTED_POLICY_VALIDATION`: the accepted distribution-policy validator accepted the generated policy
- **PASS** `SUPPORT_PROOF_UNDER_FINAL_WEIGHTS`: the accepted support builder proved 243 boards and the per-resolution ceiling
- **PASS** `WEIGHTS_SUM_TO_GRANULARITY`: weights sum to 1000000 of the 1000000-unit grid
- **PASS** `WEIGHTS_NON_NEGATIVE_INTEGERS`: every weight is a non-negative safe integer
- **PASS** `ONLY_REACHABLE_CLASSES_CARRY_WEIGHT`: unreachable classes carry zero weight (BREAK_EVEN, BIG, MAX, FEATURE_TRIGGER)
- **PASS** `WEIGHTED_CLASSES_HAVE_PROVED_EXPECTATION`: every weighted class has reachable members and a proved expectation
- **PASS** `MAX_WIN_RESOLVED_SPIN_WITHIN_CEILING`: proved per-resolution max 5.4x (paid 5.4x, free 0x) vs the declared 20x ceiling; the feature aggregate is deliberately uncapped
- **PASS** `MAX_WIN_CAP_IS_EXACT_ON_THE_SIMULATION_GRID`: cap 20x x 20 stake units = 400 exact simulation units
- **PASS** `EXPECTED_RTP_MATCHES_TARGET`: exact expected 70.00002% vs requested 70% (exact absolute error 0.00002pp, tolerance 0.01pp)
- **PASS** `TARGET_ZERO_IS_A_PROVED_ZERO_RETURN_POLICY`: not applicable (target is not 0%)
- **PASS** `REQUESTED_MINIMUM_WEIGHTS_HELD`: minimum weights held: {"LOSS":10000,"PARTIAL_HIGH":10000,"SMALL":10000}
- **PASS** `REQUESTED_MAXIMUM_WEIGHTS_HELD`: maximum weights held: {}
- **PASS** `FEATURE_EXPECTATION_PROVED_OR_ABSENT`: the declared model reaches no feature-trigger class
- **PASS** `POLICY_HASH_IS_CANONICAL`: policy hash 1ac833cd4892eb4a4238b2286d8660e7d39e11c3c0ac8150e2c216d0be0baea5 is stable across a serialization round trip
- **PASS** `POSITIVE_PROFIT_WEIGHT_WHEN_TARGET_POSITIVE`: 276389 grid units on classes with a proved expectation above 1x (floor 10000)
- **PASS** `POSITIVE_LOSS_WEIGHT_WHEN_TARGET_POSITIVE`: LOSS weight 10000 units

## Pipeline stages

- GENERATING: request 1c0abfbb1214 accepted; objective RETENTION
- GENERATED: solved 1000000 grid units across PARTIAL_LOW+SMALL (EXACT_TWO_CLASS)
- VALIDATING: 16 acceptance checks
- VALIDATED: every analytical check passed; activation is not part of this pipeline

## Bankroll sample (accepted simulator, simulation-only denomination)

- Sessions: 80; horizon: 5000 paid spins; censored 0; ruined 80
- Seeds: prefix `closure:maxwin20:rtp70:v1` (closure:maxwin20:rtp70:v1:0 .. closure:maxwin20:rtp70:v1:79)
- Initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units)
- Spins: 134312 paid + 0 free = 134312 resolved
- Ledger identity (exact units): opening 800000 + returned 1887084 - wager 2686240 = closing 844 (exact: true)
- Paid spins per session: mean 1678.9, median 1680.0, p90 1800.1
- Turnover (paid only): mean 335.78 PTS, median 336 PTS, p90 360.02 PTS
- House per session: mean wager 335.7800 PTS, mean payout 235.8855 PTS, mean net 99.8945 PTS
- Drawdown (units): mean 10007.7, median 9996.0, p90 10036.4, p95 10072.8
- Paid-event full loss 1.04%; hit 98.96%; partial 71.18%; profitable 27.78%
- Feature triggered 0.0000% of paid rounds; retriggered 0.0000%; native class mismatches 0
- Max observed paid resolved spin 40 units; free resolved spin 0 units (cap 400); feature aggregate 0 units (deliberately uncapped)

| N | Alive@N (observed) | Balance mean | Ruin by N | Ruin observed |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100.00% (80) | 9394.3 | 0.00% | 80 |
| 250 | 100.00% (80) | 8463.0 | 0.00% | 80 |
| 500 | 100.00% (80) | 7002.3 | 0.00% | 80 |
| 1000 | 100.00% (80) | 4065.9 | 0.00% | 80 |
| 2500 | 0.00% (80) | n/a | unknown | 0 |
| 5000 | 0.00% (80) | n/a | 100.00% | 80 |
| 10000 | unobserved (0) | not requested | unknown | 0 |
| 25000 | unobserved (0) | not requested | unknown | 0 |
| 50000 | unobserved (0) | not requested | unknown | 0 |

- FULL_LOSS dry spell: pooled mean 1.01 (denominator 1382 runs); longest per session mean 1.16, p90 2.0, p99 2.0
- NON_PROFITABLE dry spell: pooled mean 3.59 (denominator 27006 runs); longest per session mean 19.66, p90 24.0, p99 33.4

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
