# lucky-lady.gen.balanced.rtp90.c7dc94b3b3 - generated payout policy

- Status: **VALIDATED** (activation: **false**, testOnly: **true**)
- Generated at: 2026-01-01T00:00:00.000Z
- Request: `{"targetRtpPercent":"90","objective":"BALANCED"}`
- Normalized request: target 90%, objective BALANCED, granularity 1000000, tolerance 0.01pp
- Solver: payout-policy-solver.v1; method EXACT_TWO_CLASS; support PARTIAL_HIGH+SMALL; enumerated 15 pairs / 20 triples
- Request hash: `b091d3d4dffdfcae4409b7faafcbd9605c0e8816061efec0bc9245daeddde33c`
- Policy: `lucky-lady.gen.balanced.rtp90.c7dc94b3b3` hash `d58e023e7727680d668d43457c8f538dc0c4b80466f3bedf28f55b10314b8fff`
- Model: `lucky-lady.model.bounded-generator.v1` hash `4d66174ec81e2f9ac4701de1f54b98ac96e065d968f422e76036f3c001915bc9`
- Declared model return under its own weights: 1763.997730%; feature trigger probability 0.00099402; expected feature spins 15.2270; feature chain diverges: false
- Unreachable classes in the declared model: BREAK_EVEN, BIG, MAX

## Expected return

- Expected (exact support): 90.000036%
- Exact absolute error against the request: 0.000036pp (tolerance 0.01pp)
- Measured over the bounded sample: 89.956772% (standard error 0.0519%; 95% interval 89.855% - 90.058%)
- Statistical verdict: **PASS** (|measured - expected| = 0.0433pp, tolerance 3 x standard error + 0.5pp)

## Class weights

| Class | Weight (grid units) | Configured share | Proved expectation |
| --- | ---: | ---: | ---: |
| LOSS | 10000 | 1.0000% | 0.000000 |
| PARTIAL_LOW | 0 | 0.0000% | 0.300050 |
| PARTIAL_HIGH | 876405 | 87.6405% | 0.800000 |
| BREAK_EVEN | 0 | 0.0000% | unreachable |
| SMALL | 113595 | 11.3595% | 1.750749 |
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
- **PASS** `EXPECTED_RTP_MATCHES_TARGET`: exact expected 90.000036% vs requested 90% (exact absolute error 0.000036pp, tolerance 0.01pp)
- **PASS** `TARGET_ZERO_IS_A_PROVED_ZERO_RETURN_POLICY`: not applicable (target is not 0%)
- **PASS** `REQUESTED_MINIMUM_WEIGHTS_HELD`: minimum weights held: {"LOSS":10000,"PARTIAL_HIGH":10000,"SMALL":10000}
- **PASS** `FEATURE_EXPECTATION_PROVED_OR_ABSENT`: FEATURE_TRIGGER expectation 732.683481 (paid 19.988012, feature 712.695469)
- **PASS** `POLICY_HASH_IS_CANONICAL`: policy hash d58e023e7727680d668d43457c8f538dc0c4b80466f3bedf28f55b10314b8fff is stable across a serialization round trip
- **PASS** `POSITIVE_PROFIT_WEIGHT_WHEN_TARGET_POSITIVE`: 113595 grid units on classes with a proved expectation above 1x (floor 10000)
- **PASS** `POSITIVE_LOSS_WEIGHT_WHEN_TARGET_POSITIVE`: LOSS weight 10000 units

## Pipeline stages

- GENERATING: request b091d3d4dffd accepted; objective BALANCED
- GENERATED: solved 1000000 grid units across PARTIAL_HIGH+SMALL (EXACT_TWO_CLASS)
- VALIDATING: 15 acceptance checks
- VALIDATED: every analytical check passed; activation is not part of this pipeline

## Bankroll sample (accepted simulator, simulation-only denomination)

- Sessions: 80; horizon: 5000 paid spins; censored 34; ruined 46
- Seeds: prefix `generated:rtp90:v1` (generated:rtp90:v1:0 .. generated:rtp90:v1:79)
- Initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units)
- Spins: 392107 paid + 0 free = 392107 resolved
- Ledger identity (exact units): opening 800000 + returned 7054536 - wager 7842140 = closing 12396 (exact: true)
- Paid spins per session: mean 4901.3, median 4965.5, p90 5000.0
- Turnover (paid only): mean 980.2675 PTS, median 993.1 PTS, p90 1000 PTS
- House per session: mean wager 980.2675 PTS, mean payout 881.8170 PTS, mean net 98.4505 PTS
- Drawdown (units): mean 9858.3, median 9984.0, p90 10002.2, p95 10008.6
- Paid-event full loss 0.99%; hit 99.01%; partial 87.69%; profitable 11.32%
- Feature triggered 0.0000% of paid rounds; retriggered 0.0000%; native class mismatches 0
- Max observed paid resolved spin 50 units; free resolved spin 0 units (cap 1000); feature aggregate 0 units (deliberately uncapped)

| N | Alive@N (observed) | Balance mean | Ruin by N | Ruin observed |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100.00% (80) | 9804.6 | 0.00% | 80 |
| 250 | 100.00% (80) | 9501.6 | 0.00% | 80 |
| 500 | 100.00% (80) | 9003.3 | 0.00% | 80 |
| 1000 | 100.00% (80) | 7987.0 | 0.00% | 80 |
| 2500 | 100.00% (80) | 4966.9 | 0.00% | 80 |
| 5000 | 42.50% (80) | 342.2 | 57.50% | 80 |
| 10000 | unobserved (0) | not requested | unknown | 0 |

- FULL_LOSS dry spell: pooled mean 1.01 (denominator 3833 runs); longest per session mean 1.46, p90 2.0, p99 2.2
- NON_PROFITABLE dry spell: pooled mean 8.84 (denominator 39355 runs); longest per session mean 58.09, p90 69.1, p99 88.0

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
