# lucky-lady.test-loss-100 - payout-policy bankroll report

- **testOnly: true; activated: false** - a behaviour fixture, not a live profile.
- Game: `lucky-lady`; policy `lucky-lady.test-loss-100` v1
- Policy hash: `fd216eeffdc73a9df9a049ca01eea6ac92f5f16b27ab40a0c1e5b50630fa7b6e`
- Math profile: `lucky-lady.test.payout-policy.test-loss-100` (`d19ecabda3aeb627e573cc7d022c8e453196e97bc27c3094b4974553701aee01`)
- Run id: `ebdf142617e48c59c85db721d8b0f5a9ad4ff56fd215a8871210ccea019d9a63`; generated 2026-10-03T04:34:16.265Z
- Scope: RESOLVED_SPIN, cap 50x, MAX band floor 20x, granularity 10000
- Simulation-only denomination: 1 unit = 0.01 PTS; initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units) per paid round. The live ladder is unchanged.

## Return

- Expected (support, exact): 0% - exact expected return of the policy: class probabilities x each class's conditional expectation, computed from the policy's real reachable support
- Measured (complete paid rounds): 0%; house edge 100%
- Measured RTP uncertainty: standard error 0.00% (normal approximation over 60000 paid rounds), 95% interval 0.00% - 0.00%
- Ledger (exact units): opening 1200000 + returned 0
  - paid wager 1200000 = closing 0
  - identity holds: true

## Class frequencies (configured vs observed)

| Class | Configured | Observed | Deviation | Binomial SE | z | Support members | Conditional EV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LOSS | 100.00% | 100.00% (60000) | 0.00% | 0.00% | n/a | 1 | 0 |
| PARTIAL_LOW | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| PARTIAL_HIGH | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| BREAK_EVEN | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| SMALL | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| MEDIUM | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| BIG | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| MAX | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| FEATURE_TRIGGER | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |

Classes outside 3 standard errors: 0 (a pragmatic flag across 9 classes, not a formal simultaneous test).

## Paid-event statistics (initial paid resolution only; free spins excluded)

Denominator: 60000 paid rounds; full paid stake 20 simulation units.

| Event | Count | Rate | Wilson 95% |
| --- | ---: | ---: | --- |
| Full loss (0x) | 60000 | 100.00% | 99.99% - 100.00% |
| Hit (> 0) | 0 | 0.00% | 6.776e-19% - 0.01% |
| Profitable (> stake) | 0 | 0.00% | 6.776e-19% - 0.01% |
| Partial (0 < x < stake) | 0 | 0.00% | 6.776e-19% - 0.01% |
| Break-even (exactly stake) | 0 | 0.00% | 6.776e-19% - 0.01% |
| Non-profitable (<= stake) | 60000 | 100.00% | 99.99% - 100.00% |
| Feature triggered | 0 | 0.00% | 6.776e-19% - 0.01% |
| Retriggered | 0 | 0.00% | 6.776e-19% - 0.01% |

Native class mismatches (selected class vs native evaluation): 0
Trigger-board paid payout (units): mean null, median null, sample 0

## Sessions

- Sessions: 120; horizon: 10000 paid spins; censored 0; ruined 120
- Actual paid rounds 60000; free spins 0; resolved spins 60000
- Seeds: prefix `payout-policy:test-loss-100:v1` (payout-policy:test-loss-100:v1:0 .. payout-policy:test-loss-100:v1:119)
- Paid spins per session: mean 500.0, median 500.0, p10 500.0, p25 500.0, p75 500.0, p90 500.0, p95 500.0
- Turnover (PAID only, PTS): mean 100, median 100, p75 100, p90 100, p95 100 (total 12000 PTS)
- House per session: mean wager 100.0000 PTS, mean payout 0.0000 PTS, mean net 100.0000 PTS, median net 100.0000 PTS (edge per wager 100%)
- Drawdown (units): mean 10000.0, median 10000.0, p75 10000.0, p90 10000.0, p95 10000.0

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
| 100 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 8000.0 | 8000.0 | 8000.0 | 8000.0 | 8000.0 | 8000.0 | 8000.0 |
| 250 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 5000.0 | 5000.0 | 5000.0 | 5000.0 | 5000.0 | 5000.0 | 5000.0 |
| 500 | 120 | 120 | 100.00% | 120 | 0 | 120 | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
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
| 500 | 0.00% | 100.00% | 100.00% | 120 |
| 1000 | 0.00% | 0.00% | 0.00% | 120 |
| 2500 | 0.00% | 0.00% | 0.00% | 120 |
| 5000 | 0.00% | 0.00% | 0.00% | 120 |
| 10000 | 0.00% | 0.00% | 0.00% | 120 |

#### Balance @N | all sessions, ruin=0

Every session is represented: a reached session keeps its balance, and a session ruined before N is represented
as 0. This is kept strictly separate from the survivor-only population above.

| N | total sessions | observed | represented as 0 (ruined before N) | mean | p10 | p25 | median (P50) | p75 | p90 | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 120 | 120 | 0 | 8000.0 | 8000.0 | 8000.0 | 8000.0 | 8000.0 | 8000.0 | 8000.0 |
| 250 | 120 | 120 | 0 | 5000.0 | 5000.0 | 5000.0 | 5000.0 | 5000.0 | 5000.0 | 5000.0 |
| 500 | 120 | 120 | 0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
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
| 500 | 0.00% | 120 | 100.00% | 120 | no |
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
  - pooled run length: mean 500.00 (denominator: 120 runs), P50 500.0, P75 500.0, P90 500.0, P95 500.0, P99 500.0
  - longest run per session: mean 500.00, P50 500.0, P75 500.0, P90 500.0, P95 500.0, P99 500.0
  - the streak a session ended on is included; `runs` counts runs, not sessions
- NON_PROFITABLE dry spell: consecutive paid rounds whose initial paid payout is at or below the full paid stake
  - pooled run length: mean 500.00 (denominator: 120 runs), P50 500.0, P75 500.0, P90 500.0, P95 500.0, P99 500.0
  - longest run per session: mean 500.00, P50 500.0, P75 500.0, P90 500.0, P95 500.0, P99 500.0
  - the streak a session ended on is included; `runs` counts runs, not sessions
- Max observed paid resolved spin: 0 units (within cap: true)
- Max observed free resolved spin: 0 units (within cap 1000: true)
- Max observed feature aggregate: 0 units (aggregate above the per-spin cap is expected and deliberately uncapped: false)
- Support: 1 reachable boards, mass 1; proved per-resolution max paid 0, free 0, resolved 0

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
