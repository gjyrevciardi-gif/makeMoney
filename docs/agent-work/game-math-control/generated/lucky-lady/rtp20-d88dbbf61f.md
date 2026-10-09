# lucky-lady.gen.balanced.rtp20.d88dbbf61f - generated payout policy

- Status: **VALIDATED** (activation: **false**, testOnly: **true**)
- Generated at: 2026-01-01T00:00:00.000Z
- Request: `{"targetRtpPercent":"20","objective":"BALANCED"}`
- Normalized request: target 20%, objective BALANCED, granularity 1000000, tolerance 0.01pp
- Solver: payout-policy-solver.v1; method EXACT_TWO_CLASS; support LOSS+PARTIAL_LOW; enumerated 15 pairs / 20 triples
- Request hash: `495ca1757ca3565322404bca8cabaa19520b738859df2d70cb06f06819821273`
- Policy: `lucky-lady.gen.balanced.rtp20.d88dbbf61f` hash `cd74784ad1651090be662e4b49b2abd91a2c010d1f4eba7c15d383f0b5446694`
- Model: `lucky-lady.model.bounded-generator.v1` hash `4d66174ec81e2f9ac4701de1f54b98ac96e065d968f422e76036f3c001915bc9`
- Declared model return under its own weights: 1763.997730%; feature trigger probability 0.00099402; expected feature spins 15.2270; feature chain diverges: false
- Unreachable classes in the declared model: BREAK_EVEN, BIG, MAX

## Expected return

- Expected (exact support): 20.000006%
- Exact absolute error against the request: 0.000006pp (tolerance 0.01pp)
- Measured over the bounded sample: 19.998799% (standard error 0.1050%; 95% interval 19.793% - 20.205%)
- Statistical verdict: **PASS** (|measured - expected| = 0.0012pp, tolerance 3 x standard error + 0.5pp)

## Class weights

| Class | Weight (grid units) | Configured share | Proved expectation |
| --- | ---: | ---: | ---: |
| LOSS | 398455 | 39.8455% | 0.000000 |
| PARTIAL_LOW | 581545 | 58.1545% | 0.300050 |
| PARTIAL_HIGH | 10000 | 1.0000% | 0.800000 |
| BREAK_EVEN | 0 | 0.0000% | unreachable |
| SMALL | 10000 | 1.0000% | 1.750749 |
| MEDIUM | 0 | 0.0000% | 16.978516 |
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
- **PASS** `EXPECTED_RTP_MATCHES_TARGET`: exact expected 20.000006% vs requested 20% (exact absolute error 0.000006pp, tolerance 0.01pp)
- **PASS** `TARGET_ZERO_IS_A_PROVED_ZERO_RETURN_POLICY`: not applicable (target is not 0%)
- **PASS** `REQUESTED_MINIMUM_WEIGHTS_HELD`: minimum weights held: {"LOSS":10000,"PARTIAL_HIGH":10000,"SMALL":10000}
- **PASS** `FEATURE_EXPECTATION_PROVED_OR_ABSENT`: FEATURE_TRIGGER expectation 732.683481 (paid 19.988012, feature 712.695469)
- **PASS** `POLICY_HASH_IS_CANONICAL`: policy hash cd74784ad1651090be662e4b49b2abd91a2c010d1f4eba7c15d383f0b5446694 is stable across a serialization round trip
- **PASS** `POSITIVE_PROFIT_WEIGHT_WHEN_TARGET_POSITIVE`: 10000 grid units on classes with a proved expectation above 1x (floor 10000)
- **PASS** `POSITIVE_LOSS_WEIGHT_WHEN_TARGET_POSITIVE`: LOSS weight 398455 units

## Pipeline stages

- GENERATING: request 495ca1757ca3 accepted; objective BALANCED
- GENERATED: solved 1000000 grid units across LOSS+PARTIAL_LOW (EXACT_TWO_CLASS)
- VALIDATING: 15 acceptance checks
- VALIDATED: every analytical check passed; activation is not part of this pipeline

## Bankroll sample (accepted simulator, simulation-only denomination)

- Sessions: 80; horizon: 5000 paid spins; censored 0; ruined 80
- Seeds: prefix `generated:rtp20:v1` (generated:rtp20:v1:0 .. generated:rtp20:v1:79)
- Initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units)
- Spins: 49943 paid + 0 free = 49943 resolved
- Ledger identity (exact units): opening 800000 + returned 199760 - wager 998860 = closing 900 (exact: true)
- Paid spins per session: mean 624.3, median 623.0, p90 634.0
- Turnover (paid only): mean 124.8575 PTS, median 124.6 PTS, p90 126.8 PTS
- House per session: mean wager 124.8575 PTS, mean payout 24.9700 PTS, mean net 99.8875 PTS
- Drawdown (units): mean 9989.0, median 9987.0, p90 9998.2, p95 10000.0
- Paid-event full loss 39.55%; hit 60.45%; partial 59.46%; profitable 0.99%
- Feature triggered 0.0000% of paid rounds; retriggered 0.0000%; native class mismatches 0
- Max observed paid resolved spin 50 units; free resolved spin 0 units (cap 1000); feature aggregate 0 units (deliberately uncapped)

| N | Alive@N (observed) | Balance mean | Ruin by N | Ruin observed |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100.00% (80) | 8401.2 | 0.00% | 80 |
| 250 | 100.00% (80) | 5999.4 | 0.00% | 80 |
| 500 | 100.00% (80) | 2001.6 | 0.00% | 80 |
| 1000 | 0.00% (80) | n/a | 100.00% | 80 |
| 2500 | 0.00% (80) | n/a | 100.00% | 80 |
| 5000 | 0.00% (80) | n/a | 100.00% | 80 |
| 10000 | unobserved (0) | not requested | unknown | 0 |

- FULL_LOSS dry spell: pooled mean 1.64 (denominator 12073 runs); longest per session mean 6.55, p90 9.0, p99 10.6
- NON_PROFITABLE dry spell: pooled mean 87.06 (denominator 568 runs); longest per session mean 244.43, p90 335.7, p99 508.5

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
