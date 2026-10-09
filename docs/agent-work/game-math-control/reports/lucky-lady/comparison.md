# Payout-policy bankroll comparison (TEST fixtures)

`testOnly: true`, `activated: false`. Every row is an offline behaviour fixture with an honest canonical
artifact hash - none of them is an activated live profile, and none claims activation-grade evidence.

| Policy | Expected RTP | Measured RTP | Full loss | Partial | Hit | Feature | MaxWin (cap; observed max spin/feature aggregate, units) | Median/P90 spins | Median turnover (PTS) | Alive@500 | Alive@1000 | Ruin@500 | Reach 150 PTS | P90 full-loss streak/session | Mean house net (PTS) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| lucky-lady.test-loss-100 | 0 | 0 | 100.00% | 0.00% | 0.00% | 0.00% | cap 50x; obs 0/0 | 500.0/500.0 | 100 | 0.0% | 0.0% | 100.0% | 0.0% | 500.0 | 100.0000 |
| lucky-lady.test-break-even-100 | 100 | 100 | 0.00% | 0.00% | 100.00% | 0.00% | cap 50x; obs 20/0 | 10000.0/10000.0 | 2000 | 100.0% | 100.0% | 0.0% | 0.0% | 0.0 | 0.0000 |
| lucky-lady.test-retention | 37.25 | 36.957294 | 60.02% | 25.14% | 39.98% | 0.00% | cap 50x; obs 40/0 | 791.0/827.3 | 158.2 | 100.0% | 0.0% | 0.0% | 0.0% | 14.0 | 99.9153 |
| lucky-lady.test-high-return | 465.502922 | 465.370475 | 40.01% | 9.96% | 59.99% | 0.00% | cap 500x; obs 708/0 | 10000.0/10000.0 | 2000 | 100.0% | 100.0% | 0.0% | 100.0% | 11.0 | -7307.4095 |
| lucky-lady.test-tight | 13 | 13.141988 | 79.77% | 15.17% | 20.23% | 0.00% | cap 50x; obs 40/0 | 574.5/591.1 | 114.9 | 100.0% | 0.0% | 0.0% | 0.0% | 28.2 | 99.9157 |
| lucky-lady.test-feature-mix | 148.430642 | 148.285295 | 87.59% | 0.00% | 12.41% | 0.39% | cap 50x; obs 1000/27020 | 10000.0/10000.0 | 2000 | 100.0% | 100.0% | 0.0% | 95.0% | 70.0 | -926.1200 |

## Unsupported / refused

- `frozen-rtp50-reference`: `DISTRIBUTION_SUPPORT_TOO_LARGE` (The reachable outcome set could not be enumerated exactly, so no distribution is claimed for it.) - the accepted dense RTP50 profile cannot be represented by the bounded 4096-board index; no payout-policy sessions are claimed for it here. The historical 20M-round run measured 49.8624% under a different methodology and is not a substitute for current sessions.

## Fixtures

- `test-loss-100` (LOSS 100%): every paid round resolves the zero-return board; the account can fund exactly 500 staked rounds. Expectation: exactly 500 paid spins, 100.00 PTS turnover, zero ending balance, 0% return.
- `test-break-even-100` (BREAK_EVEN 100%): every paid round returns exactly the paid stake; the balance is unchanged and the session censors. Expectation: 100.00 PTS retained, 100% return, censored at the horizon.
- `test-retention` (RETENTION (loss + partial + small)): a low-but-nonzero return shape with meaningful partial and small returns over a bounded loss/partial-low/small support, not tuned for any optimum. Expectation: a slow negative drift; partial and small returns populate their classes.
- `test-high-return` (HIGH_RETURN (loss + partial + wins)): losses and partial returns coexist with medium and big wins; expected return is well above 100% and not flat 1x. Expectation: a strongly positive drift with losses still present in every session.
- `test-tight` (TIGHT (higher loss)): a low-return, loss-heavy reachable shape used to compare ruin timing against the other policies. Expectation: fast ruin with only occasional partial and small returns.
- `test-feature-mix` (FEATURE_MIX (loss + small + medium + trigger)): a modest feature frequency over the proved sparse fixture: one real trigger board, a paying native free-spin chain with a subcritical retrigger probability, and a tight 50x per-resolution cap. Expectation: feature payouts credited to the triggering round with no extra wager.

Run wall time: 86.52s.
