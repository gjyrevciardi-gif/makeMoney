# lucky-lady.test-break-even-100 - payout-policy bankroll report

- **testOnly: true; activated: false** - a behaviour fixture, not a live profile.
- Game: `lucky-lady`; policy `lucky-lady.test-break-even-100` v1
- Policy hash: `56a93f8e99a44c2ca77577a5a07138d0f1fa8f6a588a900baabc3d198c4bfb7a`
- Math profile: `lucky-lady.test.payout-policy.test-break-even-100` (`2c848cc248006ec597188c81611bb4ace9086606323a4c7ba13616917eb93d09`)
- Run id: `bfb176c3ba4f7b4194fd6b10677ec4a840c3a99b96d23c0d045dd07f4b36145f`; generated 2026-10-03T04:34:16.265Z
- Scope: RESOLVED_SPIN, cap 50x, MAX band floor 20x, granularity 10000
- Simulation-only denomination: 1 unit = 0.01 PTS; initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units) per paid round. The live ladder is unchanged.

## Return

- Expected (support, exact): 100% - exact expected return of the policy: class probabilities x each class's conditional expectation, computed from the policy's real reachable support
- Measured (complete paid rounds): 100%; house edge 0%
- Measured RTP uncertainty: standard error 0.00% (normal approximation over 1200000 paid rounds), 95% interval 100.00% - 100.00%
- Ledger (exact units): opening 1200000 + returned 24000000
  - paid wager 24000000 = closing 1200000
  - identity holds: true

## Class frequencies (configured vs observed)

| Class | Configured | Observed | Deviation | Binomial SE | z | Support members | Conditional EV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LOSS | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| PARTIAL_LOW | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| PARTIAL_HIGH | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| BREAK_EVEN | 100.00% | 100.00% (1200000) | 0.00% | 0.00% | n/a | 1 | 1 |
| SMALL | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| MEDIUM | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| BIG | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| MAX | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| FEATURE_TRIGGER | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |

Classes outside 3 standard errors: 0 (a pragmatic flag across 9 classes, not a formal simultaneous test).

## Paid-event statistics (initial paid resolution only; free spins excluded)

Denominator: 1200000 paid rounds; full paid stake 20 simulation units.

| Event | Count | Rate | Wilson 95% |
| --- | ---: | ---: | --- |
| Full loss (0x) | 0 | 0.00% | 0.00% - 3.201e-4% |
| Hit (> 0) | 1200000 | 100.00% | 100.00% - 100.00% |
| Profitable (> stake) | 0 | 0.00% | 0.00% - 3.201e-4% |
| Partial (0 < x < stake) | 0 | 0.00% | 0.00% - 3.201e-4% |
| Break-even (exactly stake) | 1200000 | 100.00% | 100.00% - 100.00% |
| Non-profitable (<= stake) | 1200000 | 100.00% | 100.00% - 100.00% |
| Feature triggered | 0 | 0.00% | 0.00% - 3.201e-4% |
| Retriggered | 0 | 0.00% | 0.00% - 3.201e-4% |

Native class mismatches (selected class vs native evaluation): 0
Trigger-board paid payout (units): mean null, median null, sample 0

## Sessions

- Sessions: 120; horizon: 10000 paid spins; censored 120; ruined 0
- Actual paid rounds 1200000; free spins 0; resolved spins 1200000
- Seeds: prefix `payout-policy:test-break-even-100:v1` (payout-policy:test-break-even-100:v1:0 .. payout-policy:test-break-even-100:v1:119)
- Paid spins per session: mean 10000.0, median 10000.0, p10 10000.0, p25 10000.0, p75 10000.0, p90 10000.0, p95 10000.0
- Turnover (PAID only, PTS): mean 2000, median 2000, p75 2000, p90 2000, p95 2000 (total 240000 PTS)
- House per session: mean wager 2000.0000 PTS, mean payout 2000.0000 PTS, mean net 0.0000 PTS, median net 0.0000 PTS (edge per wager 0%)
- Drawdown (units): mean 0.0, median 0.0, p75 0.0, p90 0.0, p95 0.0

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
| 100 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 250 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 500 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 1000 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 2500 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 5000 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 10000 | 120 | 120 | 100.00% | 120 | 0 | 0 | 120 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |

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
| 1000 | 100.00% | 0.00% | 100.00% | 120 |
| 2500 | 100.00% | 0.00% | 100.00% | 120 |
| 5000 | 100.00% | 0.00% | 100.00% | 120 |
| 10000 | 100.00% | 0.00% | 100.00% | 120 |

#### Balance @N | all sessions, ruin=0

Every session is represented: a reached session keeps its balance, and a session ruined before N is represented
as 0. This is kept strictly separate from the survivor-only population above.

| N | total sessions | observed | represented as 0 (ruined before N) | mean | p10 | p25 | median (P50) | p75 | p90 | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 120 | 120 | 0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 250 | 120 | 120 | 0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 500 | 120 | 120 | 0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 1000 | 120 | 120 | 0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 2500 | 120 | 120 | 0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 5000 | 120 | 120 | 0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |
| 10000 | 120 | 120 | 0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 | 10000.0 |

#### Survival and ruin

`Alive@N` means the session could still fund the next paid stake after N completed paid spins; a checkpoint beyond
the horizon is unobserved, not zero.

| N | Alive@N | Alive obs | Ruin by N | Ruin obs | beyond horizon |
| ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 100.00% | 120 | 0.00% | 120 | no |
| 250 | 100.00% | 120 | 0.00% | 120 | no |
| 500 | 100.00% | 120 | 0.00% | 120 | no |
| 1000 | 100.00% | 120 | 0.00% | 120 | no |
| 2500 | 100.00% | 120 | 0.00% | 120 | no |
| 5000 | 100.00% | 120 | 0.00% | 120 | no |
| 10000 | 100.00% | 120 | unknown | n/a | n/a |

## Reach / fall / dry spells / maxima

- reached 125 PTS: 0.00%
- reached 150 PTS: 0.00%
- reached 200 PTS: 0.00%
- fell below 20 PTS: 0.00%
- fell below 40 PTS: 0.00%
- fell below 60 PTS: 0.00%
- fell below 80 PTS: 0.00%
- FULL_LOSS dry spell: consecutive paid rounds with a zero initial paid payout
  - pooled run length: mean n/a (denominator: 0 runs), P50 n/a, P75 n/a, P90 n/a, P95 n/a, P99 n/a
  - longest run per session: mean 0.00, P50 0.0, P75 0.0, P90 0.0, P95 0.0, P99 0.0
  - the streak a session ended on is included; `runs` counts runs, not sessions
- NON_PROFITABLE dry spell: consecutive paid rounds whose initial paid payout is at or below the full paid stake
  - pooled run length: mean 10000.00 (denominator: 120 runs), P50 10000.0, P75 10000.0, P90 10000.0, P95 10000.0, P99 10000.0
  - longest run per session: mean 10000.00, P50 10000.0, P75 10000.0, P90 10000.0, P95 10000.0, P99 10000.0
  - the streak a session ended on is included; `runs` counts runs, not sessions
- Max observed paid resolved spin: 20 units (within cap: true)
- Max observed free resolved spin: 0 units (within cap 1000: true)
- Max observed feature aggregate: 0 units (aggregate above the per-spin cap is expected and deliberately uncapped: false)
- Support: 1 reachable boards, mass 1; proved per-resolution max paid 1, free 0, resolved 1

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
