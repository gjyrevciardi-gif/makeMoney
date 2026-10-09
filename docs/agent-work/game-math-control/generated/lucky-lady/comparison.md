# Automatic payout-policy generator - comparison (TEST artifacts)

`testOnly: true`, `activation: false`. The declared bounded model is NOT the accepted dense RTP50 profile;
the dense profile is refused by the bounded index (see `model.json`). Every row is an offline fixture.

- Model: `lucky-lady.model.bounded-generator.v1` hash `4d66174ec81e2f9ac4701de1f54b98ac96e065d968f422e76036f3c001915bc9`
- Reachable boards: 108; reachable classes: LOSS, PARTIAL_LOW, PARTIAL_HIGH, SMALL, MEDIUM, FEATURE_TRIGGER
- Unreachable classes: BREAK_EVEN, BIG, MAX
- Sample: 80 sessions x horizon 5000 paid spins (predeclared seeds, no seed search)

| Request | Status | Expected RTP | Exact error | Measured RTP | Statistical | Support | Full loss | Partial | Feature | Median/P90 spins | Median turnover | Alive@500 | Ruin@500 | Reach 150 PTS | P90 full-loss streak | Mean house net (PTS) |
| --- | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rtp0 | VALIDATED | 0 | 0 | 0 | PASS | LOSS | 100.00% | 0.00% | 0.00% | 500/500 | 100 | 0.00% | 100.00% | 0.00% | 500.0 | 100.0000 |
| rtp20 | VALIDATED | 20.000006 | 0.000006 | 19.998799 | PASS | LOSS+PARTIAL_LOW | 39.55% | 59.46% | 0.00% | 623/634 | 124.6 | 100.00% | 0.00% | 0.00% | 9.0 | 99.8875 |
| rtp50 | VALIDATED | 50.000013 | 0.000013 | 49.998999 | PASS | PARTIAL_LOW+PARTIAL_HIGH | 0.96% | 98.03% | 0.00% | 997/1027 | 199.3 | 100.00% | 0.00% | 0.00% | 1.0 | 99.8758 |
| rtp63p5 | VALIDATED | 63.500014 | 0.000014 | 63.632109 | PASS | PARTIAL_LOW+PARTIAL_HIGH | 0.95% | 98.01% | 0.00% | 1375/1406 | 275 | 100.00% | 0.00% | 0.00% | 2.0 | 99.8635 |
| rtp70-retention | VALIDATED | 70.000045 | 0.000045 | 70.02611 | PASS | PARTIAL_LOW+SMALL | 1.00% | 71.53% | 0.00% | 1668/1783 | 333.5 | 100.00% | 0.00% | 0.00% | 2.0 | 99.8760 |
| rtp70-volatile | VALIDATED | 69.999604 | 0.000396 | 68.891959 | PASS | LOSS+MEDIUM | 94.11% | 1.00% | 0.00% | 1516/2206 | 303.2 | 100.00% | 0.00% | 0.00% | 99.1 | 99.9042 |
| rtp90 | VALIDATED | 90.000036 | 0.000036 | 89.956772 | PASS | PARTIAL_HIGH+SMALL | 0.99% | 87.69% | 0.00% | 4966/5000 | 993.1 | 100.00% | 0.00% | 0.00% | 2.0 | 98.4505 |
| rtp100 | VALIDATED | 100.000017 | 0.000017 | 100.077475 | PASS | PARTIAL_HIGH+SMALL | 1.02% | 77.02% | 0.00% | 5000/5000 | 1000 | 100.00% | 0.00% | 0.00% | 2.0 | -0.7747 |

Run wall time: 24.84s.
