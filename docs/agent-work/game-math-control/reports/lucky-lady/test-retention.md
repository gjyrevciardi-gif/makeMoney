# lucky-lady.test-retention - payout-policy bankroll report

- **testOnly: true; activated: false** - a behaviour fixture, not a live profile.
- Game: `lucky-lady`; policy `lucky-lady.test-retention` v1
- Policy hash: `11adbde39594d4c86d10166528cac09f19edfcbb82b448007a3681aaa45dd128`
- Math profile: `lucky-lady.test.payout-policy.test-retention` (`e7bee2dd399d73f76e9359e09dc7c90645615ea7a36a24c64bd01930ba8d3056`)
- Run id: `3176bf340e54c898406f5d5fa7f1b4d45b6a80693eb5ac1ee203c81e0396ca27`; generated 2026-10-03T04:34:16.265Z
- Scope: RESOLVED_SPIN, cap 50x, MAX band floor 20x, granularity 10000
- Simulation-only denomination: 1 unit = 0.01 PTS; initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units) per paid round. The live ladder is unchanged.

## Return

- Expected (support, exact): 37.25% - exact expected return of the policy: class probabilities x each class's conditional expectation, computed from the policy's real reachable support
- Measured (complete paid rounds): 36.957294%; house edge 63.042706%
- Measured RTP uncertainty: standard error 0.23% (normal approximation over 95093 paid rounds), 95% interval 36.51% - 37.40%
- Ledger (exact units): opening 1200000 + returned 702876
  - paid wager 1901860 = closing 1016
  - identity holds: true

## Class frequencies (configured vs observed)

| Class | Configured | Observed | Deviation | Binomial SE | z | Support members | Conditional EV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LOSS | 60.00% | 60.02% (57075) | 0.02% | 0.16% | 0.13 | 135 | 0 |
| PARTIAL_LOW | 20.00% | 20.16% (19174) | 0.16% | 0.13% | 1.26 | 27 | 0.2 |
| PARTIAL_HIGH | 5.00% | 4.97% (4728) | -0.03% | 0.07% | -0.40 | 36 | 0.65 |
| BREAK_EVEN | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| SMALL | 15.00% | 14.84% (14116) | -0.16% | 0.12% | -1.34 | 27 | 2 |
| MEDIUM | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 18 | 5.4 |
| BIG | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| MAX | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| FEATURE_TRIGGER | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |

Classes outside 3 standard errors: 0 (a pragmatic flag across 9 classes, not a formal simultaneous test).

## Paid-event statistics (initial paid resolution only; free spins excluded)

Denominator: 95093 paid rounds; full paid stake 20 simulation units.

| Event | Count | Rate | Wilson 95% |
| --- | ---: | ---: | --- |
| Full loss (0x) | 57075 | 60.02% | 59.71% - 60.33% |
| Hit (> 0) | 38018 | 39.98% | 39.67% - 40.29% |
| Profitable (> stake) | 14116 | 14.84% | 14.62% - 15.07% |
| Partial (0 < x < stake) | 23902 | 25.14% | 24.86% - 25.41% |
| Break-even (exactly stake) | 0 | 0.00% | 0.00% - 4.040e-3% |
| Non-profitable (<= stake) | 80977 | 85.16% | 84.93% - 85.38% |
| Feature triggered | 0 | 0.00% | 0.00% - 4.040e-3% |
| Retriggered | 0 | 0.00% | 0.00% - 4.040e-3% |

Native class mismatches (selected class vs native evaluation): 0
Trigger-board paid payout (units): mean null, median null, sample 0

## Sessions

- Sessions: 120; horizon: 10000 paid spins; censored 0; ruined 120
- Actual paid rounds 95093; free spins 0; resolved spins 95093
- Seeds: prefix `payout-policy:test-retention:v1` (payout-policy:test-retention:v1:0 .. payout-policy:test-retention:v1:119)
- Paid spins per session: mean 792.4, median 791.0, p10 750.9, p25 769.0, p75 812.0, p90 827.3, p95 843.3
- Turnover (PAID only, PTS): mean 158.4883333333, median 158.2, p75 162.4, p90 165.46, p95 168.66 (total 19018.6 PTS)
- House per session: mean wager 158.4883 PTS, mean payout 58.5730 PTS, mean net 99.9153 PTS, median net 99.9200 PTS (edge per wager 63.042706%)
- Drawdown (units): mean 9995.6, median 9992.0, p75 10000.0, p90 10012.4, p95 10016.0

## Checkpoints

Balance figures are rounded statistical presentation in simulation units (the JSON report carries the full
quantile summaries and exact strings). Two checkpoint populations are reported and never mixed.

#### Balance @N | survivors only

Eligible population: exactly the sessions that reached N (resolved at least N paid spins). This is NOT the
accepted `Alive@N` event: `Alive@N` means the session could still fund the next paid stake after N completed paid
spins. A session that resolved exactly N and then could not fund spin N+1 is included here (it reached N) while
`Alive@N` is false. A session ruined before N is excluded. A checkpoint beyond the horizon is unobserved (`n/a`).

| N | total sessions | reached | reach rate (survivor rate) | conditional sample | excluded (ruined before N) | exact checkpoint ruin | Alive@N | mean | p10 | p25 | median (P50) | p75 | p90 | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 8740.9 | 8584.0 | 8656.0 | 8726.0 | 8824.0 | 8912.4 | 8976.4 |
| 250 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 6835.8 | 6592.4 | 6707.0 | 6844.0 | 6968.0 | 7116.0 | 7164.6 |
| 500 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 3695.8 | 3327.6 | 3486.0 | 3690.0 | 3889.0 | 4054.0 | 4129.6 |
| 1000 | 120 | 0 | 0.00% | 0 | 120 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 2500 | 120 | 0 | 0.00% | 0 | 120 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 5000 | 120 | 0 | 0.00% | 0 | 120 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 10000 | 120 | 0 | 0.00% | 0 | 120 | 0 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

Reconciliation (exact identity): `reached = Alive@N + exact checkpoint ruin`. A session that resolved exactly N
and then could not fund N+1 is counted by the accepted `Ruin by N` block while still reaching N, so it appears in
both the exact checkpoint ruin column and the survivor-only balance.

Rate reconciliation: `reach rate = Alive@N rate + exact checkpoint ruin / Alive@N observed`. The accepted `Alive@N`
calculations and `Alive@N` itself are unchanged; only the reach probability is decomposed against them.

| N | Alive@N rate | exact checkpoint ruin / observed | reach rate (survivor rate) | denominator |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100.00% | 0.00% | 100.00% | 120 |
| 250 | 100.00% | 0.00% | 100.00% | 120 |
| 500 | 100.00% | 0.00% | 100.00% | 120 |
| 1000 | 0.00% | 0.00% | 0.00% | 120 |
| 2500 | 0.00% | 0.00% | 0.00% | 120 |
| 5000 | 0.00% | 0.00% | 0.00% | 120 |
| 10000 | 0.00% | 0.00% | 0.00% | 120 |

#### Balance @N | all sessions, ruin=0

Every session is represented: a reached session keeps its balance, and a session ruined before N is represented
as 0. This is kept strictly separate from the survivor-only population above.

| N | total sessions | observed | represented as 0 (ruined before N) | mean | p10 | p25 | median (P50) | p75 | p90 | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 120 | 120 | 0 | 8740.9 | 8584.0 | 8656.0 | 8726.0 | 8824.0 | 8912.4 | 8976.4 |
| 250 | 120 | 120 | 0 | 6835.8 | 6592.4 | 6707.0 | 6844.0 | 6968.0 | 7116.0 | 7164.6 |
| 500 | 120 | 120 | 0 | 3695.8 | 3327.6 | 3486.0 | 3690.0 | 3889.0 | 4054.0 | 4129.6 |
| 1000 | 120 | 120 | 120 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 2500 | 120 | 120 | 120 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 5000 | 120 | 120 | 120 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| 10000 | 120 | 120 | 120 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

#### Survival and ruin

`Alive@N` means the session could still fund the next paid stake after N completed paid spins; a checkpoint beyond
the horizon is unobserved, not zero.

| N | Alive@N | Alive obs | Ruin by N | Ruin obs | beyond horizon |
| ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 100.00% | 120 | 0.00% | 120 | no |
| 250 | 100.00% | 120 | 0.00% | 120 | no |
| 500 | 100.00% | 120 | 0.00% | 120 | no |
| 1000 | 0.00% | 120 | 100.00% | 120 | no |
| 2500 | 0.00% | 120 | 100.00% | 120 | no |
| 5000 | 0.00% | 120 | 100.00% | 120 | no |
| 10000 | 0.00% | 120 | unknown | n/a | n/a |

## Reach / fall / dry spells / maxima

- reached 125 PTS: 0.00%
- reached 150 PTS: 0.00%
- reached 200 PTS: 0.00%
- fell below 20 PTS: 100.00%
- fell below 40 PTS: 100.00%
- fell below 60 PTS: 100.00%
- fell below 80 PTS: 100.00%
- FULL_LOSS dry spell: consecutive paid rounds with a zero initial paid payout
  - pooled run length: mean 2.50 (denominator: 22819 runs), P50 2.0, P75 3.0, P90 5.0, P95 6.0, P99 9.0
  - longest run per session: mean 11.51, P50 11.0, P75 13.0, P90 14.0, P95 15.0, P99 16.0
  - the streak a session ended on is included; `runs` counts runs, not sessions
- NON_PROFITABLE dry spell: consecutive paid rounds whose initial paid payout is at or below the full paid stake
  - pooled run length: mean 6.68 (denominator: 12117 runs), P50 5.0, P75 9.0, P90 15.0, P95 19.0, P99 28.0
  - longest run per session: mean 33.08, P50 32.0, P75 38.0, P90 43.0, P95 47.2, P99 52.8
  - the streak a session ended on is included; `runs` counts runs, not sessions
- Max observed paid resolved spin: 40 units (within cap: true)
- Max observed free resolved spin: 0 units (within cap 1000: true)
- Max observed feature aggregate: 0 units (aggregate above the per-spin cap is expected and deliberately uncapped: false)
- Support: 243 reachable boards, mass 243; proved per-resolution max paid 5.4, free 0, resolved 5.4

## Limitations

- Offline behaviour fixture: testOnly=true, activated=false. No profile was generated, validated or activated.
- The optional red/black gamble is excluded from these sessions; the reported maxima are per resolved spin and per feature aggregate only.
- Selection uses a deterministic simulation stream (class and member draws) and a separate simulation stream for the native engine; production keeps the OS CSPRNG.
- Class frequencies are drawn from the configured weights, and the fixed-n binomial standard errors are closed-form; because the number of paid rounds is random (bankroll-dependent stopping), those intervals and the normal-approximation RTP interval are approximate rather than exact multinomial inference.
- Free spins are paid by the originating round under the same locked profile and cap; free spins never debit a wager.
- The per-resolved-spin cap is compared against `maxWinMultiplier x the full locked paid stake` (never a zero free stake); the feature aggregate is reported separately and may exceed the per-spin cap by design.
- `Balance @N | survivors only` is the balance after N completed paid rounds, over exactly the sessions that reached N (resolved at least N paid spins). A session that resolved exactly N and then could not fund the next stake is included; a session ruined before N is excluded, and the conditional sample size is reported with it.
- `Balance @N | all sessions, ruin=0` keeps every session, representing each session ruined before N as 0. It is reported separately from the survivor-only statistic and the two are never mixed. A checkpoint beyond the horizon is unobserved in both.
- A checkpoint beyond a session horizon is unobserved, and a session that reached the horizon is censored, not ruined: its bust time inside the horizon is unknown and no finite bust quantile is claimed.
- The exact per-resolution cap is converted from the policy multiple with exact rational arithmetic; a non-integral cap is refused rather than rounded up.
