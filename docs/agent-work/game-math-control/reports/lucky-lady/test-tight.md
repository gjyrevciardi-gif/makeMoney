# lucky-lady.test-tight - payout-policy bankroll report

- **testOnly: true; activated: false** - a behaviour fixture, not a live profile.
- Game: `lucky-lady`; policy `lucky-lady.test-tight` v1
- Policy hash: `0c24ec6d92745527a7cb3976b985a084eba9dbb5e03406b57181757ac8fafcb0`
- Math profile: `lucky-lady.test.payout-policy.test-tight` (`f20e7753bf7e84142a50f0cb29b94b38e20ea9dc5640f340b87cb8f6562285e5`)
- Run id: `af076af25a9ba542e4255785c14c5eefb4c86bb2e63ed3e92c6fcd9a3f39641c`; generated 2026-10-03T04:34:16.265Z
- Scope: RESOLVED_SPIN, cap 50x, MAX band floor 20x, granularity 10000
- Simulation-only denomination: 1 unit = 0.01 PTS; initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units) per paid round. The live ladder is unchanged.

## Return

- Expected (support, exact): 13% - exact expected return of the policy: class probabilities x each class's conditional expectation, computed from the policy's real reachable support
- Measured (complete paid rounds): 13.141988%; house edge 86.858012%
- Measured RTP uncertainty: standard error 0.17% (normal approximation over 69020 paid rounds), 95% interval 12.82% - 13.47%
- Ledger (exact units): opening 1200000 + returned 181412
  - paid wager 1380400 = closing 1012
  - identity holds: true

## Class frequencies (configured vs observed)

| Class | Configured | Observed | Deviation | Binomial SE | z | Support members | Conditional EV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LOSS | 80.00% | 79.77% (55059) | -0.23% | 0.15% | -1.49 | 135 | 0 |
| PARTIAL_LOW | 15.00% | 15.17% (10473) | 0.17% | 0.14% | 1.28 | 27 | 0.2 |
| PARTIAL_HIGH | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 36 | 0.65 |
| BREAK_EVEN | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| SMALL | 5.00% | 5.05% (3488) | 0.05% | 0.08% | 0.65 | 27 | 2 |
| MEDIUM | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 18 | 5.4 |
| BIG | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| MAX | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| FEATURE_TRIGGER | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |

Classes outside 3 standard errors: 0 (a pragmatic flag across 9 classes, not a formal simultaneous test).

## Paid-event statistics (initial paid resolution only; free spins excluded)

Denominator: 69020 paid rounds; full paid stake 20 simulation units.

| Event | Count | Rate | Wilson 95% |
| --- | ---: | ---: | --- |
| Full loss (0x) | 55059 | 79.77% | 79.47% - 80.07% |
| Hit (> 0) | 13961 | 20.23% | 19.93% - 20.53% |
| Profitable (> stake) | 3488 | 5.05% | 4.89% - 5.22% |
| Partial (0 < x < stake) | 10473 | 15.17% | 14.91% - 15.44% |
| Break-even (exactly stake) | 0 | 0.00% | 0.00% - 0.01% |
| Non-profitable (<= stake) | 65532 | 94.95% | 94.78% - 95.11% |
| Feature triggered | 0 | 0.00% | 0.00% - 0.01% |
| Retriggered | 0 | 0.00% | 0.00% - 0.01% |

Native class mismatches (selected class vs native evaluation): 0
Trigger-board paid payout (units): mean null, median null, sample 0

## Sessions

- Sessions: 120; horizon: 10000 paid spins; censored 0; ruined 120
- Actual paid rounds 69020; free spins 0; resolved spins 69020
- Seeds: prefix `payout-policy:test-tight:v1` (payout-policy:test-tight:v1:0 .. payout-policy:test-tight:v1:119)
- Paid spins per session: mean 575.2, median 574.5, p10 561.0, p25 567.0, p75 584.0, p90 591.1, p95 598.0
- Turnover (PAID only, PTS): mean 115.0333333333, median 114.9, p75 116.8, p90 118.22, p95 119.6 (total 13804 PTS)
- House per session: mean wager 115.0333 PTS, mean payout 15.1177 PTS, mean net 99.9157 PTS, median net 99.9200 PTS (edge per wager 86.858012%)
- Drawdown (units): mean 9993.7, median 9992.0, p75 9996.0, p90 10000.4, p95 10016.0

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
| 100 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 8261.4 | 8159.6 | 8200.0 | 8258.0 | 8313.0 | 8376.0 | 8408.8 |
| 250 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 5648.7 | 5479.6 | 5555.0 | 5652.0 | 5736.0 | 5800.0 | 5845.0 |
| 500 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 1309.5 | 1079.2 | 1176.0 | 1292.0 | 1456.0 | 1560.8 | 1624.2 |
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
| 100 | 120 | 120 | 0 | 8261.4 | 8159.6 | 8200.0 | 8258.0 | 8313.0 | 8376.0 | 8408.8 |
| 250 | 120 | 120 | 0 | 5648.7 | 5479.6 | 5555.0 | 5652.0 | 5736.0 | 5800.0 | 5845.0 |
| 500 | 120 | 120 | 0 | 1309.5 | 1079.2 | 1176.0 | 1292.0 | 1456.0 | 1560.8 | 1624.2 |
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
  - pooled run length: mean 4.94 (denominator: 11154 runs), P50 4.0, P75 7.0, P90 11.0, P95 14.0, P99 21.0
  - longest run per session: mean 22.90, P50 22.0, P75 25.0, P90 28.2, P95 35.0, P99 42.4
  - the streak a session ended on is included; `runs` counts runs, not sessions
- NON_PROFITABLE dry spell: consecutive paid rounds whose initial paid payout is at or below the full paid stake
  - pooled run length: mean 19.25 (denominator: 3404 runs), P50 13.0, P75 27.0, P90 44.0, P95 56.0, P99 86.0
  - longest run per session: mean 75.19, P50 70.5, P75 86.0, P90 103.4, P95 122.0, P99 157.0
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
