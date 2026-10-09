# lucky-lady.gen.balanced.rtp0.f4bc5decb0 - generated payout policy

- Status: **VALIDATED** (activation: **false**, testOnly: **true**)
- Generated at: 2026-01-01T00:00:00.000Z
- Request: `{"targetRtpPercent":"0","objective":"BALANCED"}`
- Normalized request: target 0%, objective BALANCED, granularity 1000000, tolerance 0.01pp
- Solver: payout-policy-solver.v1; method EXACT_SINGLE_CLASS; support LOSS; enumerated 15 pairs / 20 triples
- Request hash: `a23c94ac53a4404d5c962911fc003f64847997f404e3da1b61b3392ecb82f348`
- Policy: `lucky-lady.gen.balanced.rtp0.f4bc5decb0` hash `16d583fc8395149ba98e9ac55a1a1c1ad2c14490b4dbdafdfd03352707b1b00c`
- Model: `lucky-lady.model.bounded-generator.v1` hash `4d66174ec81e2f9ac4701de1f54b98ac96e065d968f422e76036f3c001915bc9`
- Declared model return under its own weights: 1763.997730%; feature trigger probability 0.00099402; expected feature spins 15.2270; feature chain diverges: false
- Unreachable classes in the declared model: BREAK_EVEN, BIG, MAX

## Expected return

- Expected (exact support): 0%
- Exact absolute error against the request: 0pp (tolerance 0.01pp)
- Measured over the bounded sample: 0% (standard error 0.0000%; 95% interval 0.000% - 0.000%)
- Statistical verdict: **PASS** (|measured - expected| = 0.0000pp, tolerance 3 x standard error + 0.5pp)

## Class weights

| Class | Weight (grid units) | Configured share | Proved expectation |
| --- | ---: | ---: | ---: |
| LOSS | 1000000 | 100.0000% | 0.000000 |
| PARTIAL_LOW | 0 | 0.0000% | 0.300050 |
| PARTIAL_HIGH | 0 | 0.0000% | 0.800000 |
| BREAK_EVEN | 0 | 0.0000% | unreachable |
| SMALL | 0 | 0.0000% | 1.750749 |
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
- **PASS** `EXPECTED_RTP_MATCHES_TARGET`: exact expected 0% vs requested 0% (exact absolute error 0pp, tolerance 0.01pp)
- **PASS** `TARGET_ZERO_IS_A_PROVED_ZERO_RETURN_POLICY`: a 0% target carries weight only on classes whose proved expectation is exactly zero
- **PASS** `REQUESTED_MINIMUM_WEIGHTS_HELD`: minimum weights held: {}
- **PASS** `FEATURE_EXPECTATION_PROVED_OR_ABSENT`: FEATURE_TRIGGER expectation 732.683481 (paid 19.988012, feature 712.695469)
- **PASS** `POLICY_HASH_IS_CANONICAL`: policy hash 16d583fc8395149ba98e9ac55a1a1c1ad2c14490b4dbdafdfd03352707b1b00c is stable across a serialization round trip
- **PASS** `POSITIVE_PROFIT_WEIGHT_WHEN_TARGET_POSITIVE`: target 0%: no profitable class may carry weight
- **PASS** `POSITIVE_LOSS_WEIGHT_WHEN_TARGET_POSITIVE`: LOSS weight 1000000 units

## Pipeline stages

- GENERATING: request a23c94ac53a4 accepted; objective BALANCED
- GENERATED: solved 1000000 grid units across LOSS (EXACT_SINGLE_CLASS)
- VALIDATING: 15 acceptance checks
- VALIDATED: every analytical check passed; activation is not part of this pipeline

## Bankroll sample (accepted simulator, simulation-only denomination)

- Sessions: 80; horizon: 5000 paid spins; censored 0; ruined 80
- Seeds: prefix `generated:rtp0:v1` (generated:rtp0:v1:0 .. generated:rtp0:v1:79)
- Initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units)
- Spins: 40000 paid + 0 free = 40000 resolved
- Ledger identity (exact units): opening 800000 + returned 0 - wager 800000 = closing 0 (exact: true)
- Paid spins per session: mean 500.0, median 500.0, p90 500.0
- Turnover (paid only): mean 100 PTS, median 100 PTS, p90 100 PTS
- House per session: mean wager 100.0000 PTS, mean payout 0.0000 PTS, mean net 100.0000 PTS
- Drawdown (units): mean 10000.0, median 10000.0, p90 10000.0, p95 10000.0
- Paid-event full loss 100.00%; hit 0.00%; partial 0.00%; profitable 0.00%
- Feature triggered 0.0000% of paid rounds; retriggered 0.0000%; native class mismatches 0
- Max observed paid resolved spin 0 units; free resolved spin 0 units (cap 1000); feature aggregate 0 units (deliberately uncapped)

| N | Alive@N (observed) | Balance mean | Ruin by N | Ruin observed |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100.00% (80) | 8000.0 | 0.00% | 80 |
| 250 | 100.00% (80) | 5000.0 | 0.00% | 80 |
| 500 | 0.00% (80) | 0.0 | 100.00% | 80 |
| 1000 | 0.00% (80) | n/a | 100.00% | 80 |
| 2500 | 0.00% (80) | n/a | 100.00% | 80 |
| 5000 | 0.00% (80) | n/a | 100.00% | 80 |
| 10000 | unobserved (0) | not requested | unknown | 0 |

- FULL_LOSS dry spell: pooled mean 500.00 (denominator 80 runs); longest per session mean 500.00, p90 500.0, p99 500.0
- NON_PROFITABLE dry spell: pooled mean 500.00 (denominator 80 runs); longest per session mean 500.00, p90 500.0, p99 500.0

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
