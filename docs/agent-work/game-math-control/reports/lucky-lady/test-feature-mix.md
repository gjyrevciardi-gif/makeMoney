# lucky-lady.test-feature-mix - payout-policy bankroll report

- **testOnly: true; activated: false** - a behaviour fixture, not a live profile.
- Game: `lucky-lady`; policy `lucky-lady.test-feature-mix` v1
- Policy hash: `605d5c7b60c1457b10cb4cc48d18359bafc191dc19a197ff5299b456a4be568b`
- Math profile: `lucky-lady.test.payout-policy.test-feature-mix` (`dcb96cb04ca7a9bf65b95503dd17196a93d71348f0c9126b76ee0264cbcd0e40`)
- Run id: `ac2ccd7cb822f3d920e99f07dc221db154ea8b361d239b11b683eade9147486c`; generated 2026-10-03T04:34:16.265Z
- Scope: RESOLVED_SPIN, cap 50x, MAX band floor 20x, granularity 10000
- Simulation-only denomination: 1 unit = 0.01 PTS; initial balance 100.00 PTS (10000 units); paid stake 0.20 PTS (20 units) per paid round. The live ladder is unchanged.

## Return

- Expected (support, exact): 148.430642% - exact expected return of the policy: class probabilities x each class's conditional expectation, computed from the policy's real reachable support
- Measured (complete paid rounds): 148.285295%; house edge -48.285295%
- Measured RTP uncertainty: standard error 2.39% (normal approximation over 575405 paid rounds), 95% interval 143.59% - 152.98%
- Ledger (exact units): opening 600000 + returned 17064820
  - paid wager 11508100 = closing 6156720
  - identity holds: true

## Class frequencies (configured vs observed)

| Class | Configured | Observed | Deviation | Binomial SE | z | Support members | Conditional EV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LOSS | 87.60% | 87.59% (503989) | -0.01% | 0.04% | -0.26 | 4 | 0 |
| PARTIAL_LOW | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| PARTIAL_HIGH | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| BREAK_EVEN | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| SMALL | 10.00% | 10.04% (57775) | 0.04% | 0.04% | 1.03 | 1 | 2 |
| MEDIUM | 2.00% | 1.98% (11379) | -0.02% | 0.02% | -1.22 | 2 | 16.4761904762 |
| BIG | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| MAX | 0.00% | 0.00% (0) | 0.00% | 0.00% | n/a | 0 | n/a |
| FEATURE_TRIGGER | 0.40% | 0.39% (2262) | -0.01% | 0.01% | -0.83 | 1 | 238.6956521739 |

Classes outside 3 standard errors: 0 (a pragmatic flag across 9 classes, not a formal simultaneous test).

## Paid-event statistics (initial paid resolution only; free spins excluded)

Denominator: 575405 paid rounds; full paid stake 20 simulation units.

| Event | Count | Rate | Wilson 95% |
| --- | ---: | ---: | --- |
| Full loss (0x) | 503989 | 87.59% | 87.50% - 87.67% |
| Hit (> 0) | 71416 | 12.41% | 12.33% - 12.50% |
| Profitable (> stake) | 71416 | 12.41% | 12.33% - 12.50% |
| Partial (0 < x < stake) | 0 | 0.00% | 0.00% - 6.676e-4% |
| Break-even (exactly stake) | 0 | 0.00% | 0.00% - 6.676e-4% |
| Non-profitable (<= stake) | 503989 | 87.59% | 87.50% - 87.67% |
| Feature triggered | 2262 | 0.39% | 0.38% - 0.41% |
| Retriggered | 381 | 0.07% | 0.06% - 0.07% |

Native class mismatches (selected class vs native evaluation): 0
Trigger-board paid payout (units): mean 400, median 400, sample 2262

## Sessions

- Sessions: 60; horizon: 10000 paid spins; censored 57; ruined 3
- Actual paid rounds 575405; free spins 41880; resolved spins 617285
- Seeds: prefix `payout-policy:test-feature-mix:v1` (payout-policy:test-feature-mix:v1:0 .. payout-policy:test-feature-mix:v1:59)
- Paid spins per session: mean 9590.1, median 10000.0, p10 10000.0, p25 10000.0, p75 10000.0, p90 10000.0, p95 10000.0
- Turnover (PAID only, PTS): mean 1918.0166666667, median 2000, p75 2000, p90 2000, p95 2000 (total 115081 PTS)
- House per session: mean wager 1918.0167 PTS, mean payout 2844.1367 PTS, mean net -926.1200 PTS, median net -965.1000 PTS (edge per wager -48.285295%)
- Drawdown (units): mean 12644.7, median 12430.0, p75 14800.0, p90 17010.0, p95 19983.0

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
| 100 | 60 | 60 | 100.00% | 60 | 0 | 0 | 60 | 10767.7 | 8696.0 | 8920.0 | 9180.0 | 10735.0 | 14800.0 | 17497.0 |
| 250 | 60 | 60 | 100.00% | 60 | 0 | 0 | 60 | 13168.0 | 7332.0 | 7935.0 | 12430.0 | 16060.0 | 20168.0 | 23564.0 |
| 500 | 60 | 60 | 100.00% | 60 | 0 | 0 | 60 | 14118.3 | 6288.0 | 9130.0 | 13050.0 | 16780.0 | 22298.0 | 24849.0 |
| 1000 | 60 | 60 | 100.00% | 60 | 0 | 0 | 60 | 20943.3 | 9764.0 | 13320.0 | 19260.0 | 26605.0 | 32912.0 | 42421.0 |
| 2500 | 60 | 58 | 96.67% | 58 | 2 | 0 | 58 | 39220.7 | 20412.0 | 29200.0 | 35150.0 | 47535.0 | 61358.0 | 71407.0 |
| 5000 | 60 | 57 | 95.00% | 57 | 3 | 0 | 57 | 61644.6 | 24856.0 | 39120.0 | 62840.0 | 81340.0 | 98320.0 | 104416.0 |
| 10000 | 60 | 57 | 95.00% | 57 | 3 | 0 | 57 | 108012.6 | 60608.0 | 78320.0 | 108120.0 | 135040.0 | 160816.0 | 171400.0 |

Reconciliation (exact identity): `reached = Alive@N + exact checkpoint ruin`. A session that resolved exactly N
and then could not fund N+1 is counted by the accepted `Ruin by N` block while still reaching N, so it appears in
both the exact checkpoint ruin column and the survivor-only balance.

Rate reconciliation: `reach rate = Alive@N rate + exact checkpoint ruin / Alive@N observed`. The accepted `Alive@N`
calculations and `Alive@N` itself are unchanged; only the reach probability is decomposed against them.

| N | Alive@N rate | exact checkpoint ruin / observed | reach rate (survivor rate) | denominator |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100.00% | 0.00% | 100.00% | 60 |
| 250 | 100.00% | 0.00% | 100.00% | 60 |
| 500 | 100.00% | 0.00% | 100.00% | 60 |
| 1000 | 100.00% | 0.00% | 100.00% | 60 |
| 2500 | 96.67% | 0.00% | 96.67% | 60 |
| 5000 | 95.00% | 0.00% | 95.00% | 60 |
| 10000 | 95.00% | 0.00% | 95.00% | 60 |

#### Balance @N | all sessions, ruin=0

Every session is represented: a reached session keeps its balance, and a session ruined before N is represented
as 0. This is kept strictly separate from the survivor-only population above.

| N | total sessions | observed | represented as 0 (ruined before N) | mean | p10 | p25 | median (P50) | p75 | p90 | p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 60 | 60 | 0 | 10767.7 | 8696.0 | 8920.0 | 9180.0 | 10735.0 | 14800.0 | 17497.0 |
| 250 | 60 | 60 | 0 | 13168.0 | 7332.0 | 7935.0 | 12430.0 | 16060.0 | 20168.0 | 23564.0 |
| 500 | 60 | 60 | 0 | 14118.3 | 6288.0 | 9130.0 | 13050.0 | 16780.0 | 22298.0 | 24849.0 |
| 1000 | 60 | 60 | 0 | 20943.3 | 9764.0 | 13320.0 | 19260.0 | 26605.0 | 32912.0 | 42421.0 |
| 2500 | 60 | 60 | 2 | 37913.3 | 17528.0 | 28570.0 | 33920.0 | 47165.0 | 60906.0 | 70869.0 |
| 5000 | 60 | 60 | 3 | 58562.3 | 23432.0 | 37360.0 | 60680.0 | 78850.0 | 98080.0 | 104044.0 |
| 10000 | 60 | 60 | 3 | 102612.0 | 48572.0 | 75150.0 | 106510.0 | 134995.0 | 159184.0 | 171055.0 |

#### Survival and ruin

`Alive@N` means the session could still fund the next paid stake after N completed paid spins; a checkpoint beyond
the horizon is unobserved, not zero.

| N | Alive@N | Alive obs | Ruin by N | Ruin obs | beyond horizon |
| ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 100.00% | 60 | 0.00% | 60 | no |
| 250 | 100.00% | 60 | 0.00% | 60 | no |
| 500 | 100.00% | 60 | 0.00% | 60 | no |
| 1000 | 100.00% | 60 | 0.00% | 60 | no |
| 2500 | 96.67% | 60 | 3.33% | 60 | no |
| 5000 | 95.00% | 60 | 5.00% | 60 | no |
| 10000 | 95.00% | 60 | unknown | n/a | n/a |

## Reach / fall / dry spells / maxima

- reached 125 PTS: 96.67%
- reached 150 PTS: 95.00%
- reached 200 PTS: 95.00%
- fell below 20 PTS: 6.67%
- fell below 40 PTS: 13.33%
- fell below 60 PTS: 28.33%
- fell below 80 PTS: 56.67%
- FULL_LOSS dry spell: consecutive paid rounds with a zero initial paid payout
  - pooled run length: mean 8.04 (denominator: 62702 runs), P50 6.0, P75 11.0, P90 18.0, P95 23.0, P99 35.0
  - longest run per session: mean 57.55, P50 57.0, P75 63.3, P90 70.0, P95 73.0, P99 79.2
  - the streak a session ended on is included; `runs` counts runs, not sessions
- NON_PROFITABLE dry spell: consecutive paid rounds whose initial paid payout is at or below the full paid stake
  - pooled run length: mean 8.04 (denominator: 62702 runs), P50 6.0, P75 11.0, P90 18.0, P95 23.0, P99 35.0
  - longest run per session: mean 57.55, P50 57.0, P75 63.3, P90 70.0, P95 73.0, P99 79.2
  - the streak a session ended on is included; `runs` counts runs, not sessions
- Max observed paid resolved spin: 400 units (within cap: true)
- Max observed free resolved spin: 1000 units (within cap 1000: true)
- Max observed feature aggregate: 27020 units (aggregate above the per-spin cap is expected and deliberately uncapped: true)
- Support: 8 reachable boards, mass 84; proved per-resolution max paid 20, free 50, resolved 50

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
