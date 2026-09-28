# Lucky Lady clean math model and RTP50 profile

Scope: a pure, standalone reimplementation of the Lucky Lady's Charm Deluxe maths, a verbatim
reference oracle over the pinned original PHP, a raw million-round baseline, one calibrated
`lucky-lady.rtp50.v1` profile, and an independent 20 million round validation. No runtime, client,
recovery, database or platform file was modified.

Baseline worktree commit: `5592edb`. Acceptance covers only this standalone model and the validated 10-line configuration; nothing is activated in the runtime.

## 1. Source classification (pinned originals)

Pinned upstream: `taxipult/goldsvet` at `661bc54ddc31ce952c142426d783756c4047a484`,
paths under `casino/app/Games/LuckyLadysCharmDX/`.

| File | sha256 | Bytes |
|---|---|---|
| `Server.php` | `9b7961b867e7b897b39f23274e1d6abf151b3fce5e18ed8ba278aa704a07423b` | 43517 |
| `SlotSettings.php` | `372aff5e9f275d96693f0e88740080b64922086091546c80ea8c40cdc397b095` | 43523 |
| `reels.txt` | `64cf839d1f584061f4e3fe813377c4f0396832a52e7e26493974e71363235efa` | 5353 |

Classification used throughout:

- **A - adopted semantics.** Executed verbatim or ported line-for-line, and cross-checked against the
  original: symbol list, paytable literals, the ten paylines, left-to-right prefix evaluation,
  wild `P_1` with `slotWildMpl = 2`, scatter `SCAT` paytable, the 15-spin award and the `+15`
  retrigger rule. These are the only behaviours the pure model implements.
- **B - excluded financial/accounting logic.** Balance debit/credit, bank accounting,
  currency/denomination conversion, ledger/log persistence, auth and session handling.
  Original reel strips and stake-independent rule constants are mathematical inputs (A).
- **C - excluded outcome manipulation.** `GetSpinSettings` RTP feedback
  (`stat_in`/`stat_out`, `RtpControlCount`, `SpinWinLimit`, `RandomPay`/`GetRandomPay` history gate),
  shop `percent`, `GetBank`/`SetBank` caps and `InternalError` aborts, `MaxWin` capping, the
  low-balance pity win, the scatter-forcing bonus board generator (`GetRandomScatterPos` and the
  `winType == 'bonus'` branch of `GetReelStrips`) and the `winType` category search loop.
  Bank accounting is B; using bank funds to suppress or redraw outcomes is C.
  Neither B nor C affects the pure outcome. Gamble is separately excluded from this model.

## 2. Rules implemented

- 5 reels x 3 visible rows. 5 populated strips of 125 symbols (`reelStrip6` is empty in the source).
- Raw baseline board = uniform stop `0..len-3` per reel, board rows `strip[stop..stop+2]`, no wrap.
- 10 paylines: `[2,2,2,2,2] [1,1,1,1,1] [3,3,3,3,3] [1,2,3,2,1] [3,2,1,2,3] [2,3,3,3,2] [2,1,1,1,2] [3,3,2,1,1] [1,1,2,3,3] [3,2,2,2,1]` (1-based rows).
- Paytable (array indices/counts 0..5): `P_1 [0,0,10,250,2500,9000]`, `P_2`/`P_3` `[0,0,0,15,75,250]`,
  `P_4`/`P_5` `[0,0,2,25,125,750]`, `P_6` `[0,0,0,20,100,400]`, `A`/`K` `[0,0,0,10,50,125]`,
  `Q`/`J`/`10` `[0,0,0,5,25,100]`, `9` `[0,0,2,5,25,100]`, `SCAT` `[0,0,2,5,20,500]`.
- Wild multiplier: if the matching prefix contains a wild but not only wilds, the line pays x2.
- Scatter: the original scans cells `0..3` of each reel (cell 3 is the empty filler), so only the
  three visible rows can hold scatters. `scatterWin = PAYTABLE[SCAT][count] x bet x lines`.
- 3+ scatters award 15 free spins; free-spin line wins use the x3 feature multiplier, while
  scatter awards are not multiplied (matching original Server.php line 561);
  a further 3+ scatters during the feature adds another 15 spins (retrigger).
- Money is counted in integer units of the smallest stake; `bet` and `lines` are validated positive
  integers (lines 1..10). Round RTP uses `return / (bet x lines)`.

Unit conversion: `bet = 1` represents one selected integer unit per line (for example one cent
for a 0.01 monetary stake). Line awards multiply the paytable by per-line stake; scatter awards
multiply by total stake. Native `SetBalance` multiplies by `CurrentDenom` (SlotSettings.php:786);
that account conversion is outside the pure model. Simulated totals below are integer units,
not dollar amounts. Monetary scaling does not change RTP within the safe integer range.
## 3. Reference evidence (independent oracle)

`math/oracle-extract.mjs` verifies the three pinned source hashes, then extracts two verbatim
regions of the original `Server.php` into a generated test-only oracle in the external runtime tree:

- evaluation block, source line 397 (`for( $k = 0; ...)`) - 14977 characters;
- free-spin award block, source line 648 (`if( $scattersCount >= 3 )`) - 1115 characters.

The oracle executes those substrings with `eval()` against the extracted paytable, symbol list,
line table, `slotWildMpl`, `slotFreeMpl` and `slotFreeCount` (all read from source, none hardcoded).
Extraction asserts brace balance so a mis-anchored slice fails loudly. Generated oracle sha256:
`ab6d357bb515ec3b30bb5bc47f30ddbccdf1d3457774a247f7a7453fde310efa` (`math/runs/oracle-manifest.json`).

`math/test-vectors.mjs` compares the pure engine against that oracle over **514 vectors**
(13 crafted edge boards, 1 stake variant and 500 random real-strip boards), matching **every
individual winning line id and amount**, plus base win, scatter count, scatter win and total win:
`mismatches = 0`. Crafted coverage: no-win, ordinary 3-of-a-kind, leading wild, all-wild line,
mixed wilds, 2/3/4/5 scatters, multi-line, single-line count, x3 feature multiplier, non-unit stake.

Feature rule agreement is checked against the original award block, not the new engine:

| Case | freeGames before | scatters | engine | oracle |
|---|---|---|---|---|
| first trigger | 0 | 3 | 15 | 15 |
| retrigger | 15 | 3 | 30 | 30 |
| below threshold | 0 | 2 | 0 | 0 |
| retrigger at 5 scatters | 30 | 5 | 45 | 45 |

Exact feature-round accounting uses strictly in-range scripted draws (the engine now rejects
out-of-range injected draws instead of fabricating a stop):

| Case | spins | retriggers | RNG draws | expected draws |
|---|---|---|---|---|
| exact 15 (no retrigger) | 15 | 0 | 80 | 5 x (1 + 15) |
| exact 30 (one retrigger) | 30 | 1 | 155 | 5 x (1 + 30) |

Captured sequences confirm the retrigger flag, `remainingAfter = 29` after the retrigger, and that
per-spin cumulative feature payouts sum to the final feature win. 29 focused checks total, zero
failures (`math/runs/vectors.json`).

## 4. Raw baseline (uniform stops on the original strips)

`math/simulate.mjs`, 1,000,000 complete paid rounds, seed `raw-baseline-1`
(`math/runs/raw-baseline-1m.json`). Units: percentages are return/wager; "base" includes paid-round
line wins and paid-round scatter wins.

| Metric | Value |
|---|---|
| RTP | 466.0026 % (95% CI 460.3407 .. 471.6646) |
| standard error | 2.8888 pp |
| paid rounds | 1,000,000 |
| free spins generated | 263,805 |
| total wager | 10,000,000 units |
| total return | 46,600,262 units |
| base return, including paid scatter | 26,783,318 units |
| feature return | 19,816,944 units |
| house edge | -366.0026% |
| base contribution, including paid scatter | 267.8332 pp |
| paid line contribution | 239.3825 pp |
| paid scatter contribution | 28.4507 pp |
| feature contribution | 198.1694 pp |
| hit rate | 53.7152 % |
| feature trigger rate | 1.3878 % |
| retrigger event rate per paid round | 0.3709 % (3,709 events) |
| free spins per paid round | 0.2638 |
| largest round return | 3818.8 x stake |

The original strips with uniform stops return far above 100%. This is a measurement of the
explicit unconditioned model, not of the original filtered runtime or the author's intent.

## 5. Calibration (kept separate from validation)

Only one legitimate lever was used: fixed **pre-outcome per-reel stop weights** over the original
strips. For every reel a designated window family is weighted `995`, every other stop weight `10`.
Families are disjoint between adjacent reels and every symbol, including `P_1` and `SCAT`, retains
non-zero probability on every reel, so every symbol and feature stays possible. No draw, payout
balance, bank, history or user state is consulted; one stop is drawn per reel and evaluated once.

Search trail (`math/runs/calibration-*.json`, all runs preserved):

| Scheme | Result |
|---|---|
| premium-symbol down-weighting | floor ~197 % - rejected as insufficient |
| reel-set window weighting (inverted) | no effect - recorded as an invalid trial |
| derived sorted strips | runaway feature chains - discarded; never used in final validation |
| `measure()` dropping its weight argument | two scans invalidated and re-run - recorded |
| window-family scan 2..2048 (100k) | 429 % -> 1.4 % |
| window-family bisect 48..112 (200k) | 105.7 -> 42.1 |
| window-family refine 92..100 (300k) | 50.8 .. 55.0 |
| fine 99..101.4 with integer-scaled weights (1M) | 48.3 .. 50.5, crossing ~99.5 |

Frozen parameters: `preferredWeight = 995`, `otherWeight = 10` (effective 99.5). Frozen profile:
`math/profiles/lucky-lady.rtp50.v1.json`
canonical hash `eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f`,
math-only hash `6bde6765143e926e9f19d16a4f66cb757f13053026a2050a0717fab2ce0b38b9`.
The math hash was identical across every freeze; only descriptive metadata changed.

## 6. Independent validation (frozen profile, fresh seeds)

`math/freeze.mjs --validate`, seeds `validation-a` .. `validation-t` (20 seeds never used for
calibration), 1,000,000 paid rounds each, 20,000,000 total
(`math/runs/validation-rtp50.json`, `validation-rtp50-6m.json` is the earlier 6M interim).

| Metric | Value |
|---|---|
| total paid rounds | 20,000,000 |
| total wager | 200,000,000 units |
| total return | 99,724,707 units |
| line wins | 91,391,986 units |
| paid scatter wins | 5,983,710 units |
| feature wins | 2,349,011 units |
| free spins played | 167,610 |
| retrigger events | 89 |
| observed RTP | 49.8624 % |
| target / signed error | 50.00% / -0.1376465 percentage points |
| house edge | 50.1376465% |
| base RTP, including paid scatter | 48.687848% |
| feature RTP | 1.1745055% |
| standard error | 0.0877 pp |
| 95% CI | 49.6905 .. 50.0342 |
| observed within 49.5..50.5 | PASS |
| CI contained in 49.5..50.5 | PASS |
| acceptance gate | **PASS** |
| hit rate | 21.010065% per paid round |
| feature trigger rate | 0.055425% per paid round |
| retrigger rate | 0.053099457% per free spin (89 / 167,610) |
| validation run ID | `rtp50-validation-2026-09-28T14:45:27.678Z` |

Validation re-asserts the frozen profile's canonical hash, the three pinned source hashes against
the files on disk, and records the evaluator code hash
`0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`.

### Subcriticality of the free-spin process

`scatterPmf()` in `math/freeze.mjs` convolves each reel's weighted window distribution exactly
(no simulation) to obtain the scatter-count PMF:

- `P(scatter >= 3) = 0.00055540`
- analytic branching factor `15 x P(scatter >= 3) = 0.008331 < 1` - subcritical, finite expected
  chain length. No incomplete chain contributes to a reported return.
- empirical retriggers per free spin from the validation sample `0.00053100`, labelled as an
  estimate only; its branching equivalent `0.007965` agrees with the analytic value.

`playRound` fails the run if a chain exceeds 20,000 spins; it never truncates or drops a partial
return.

## 7. Gamble exclusion

The original post-win gamble is a separate double-or-nothing on an already settled win: it does not
change board generation, paylines, paytable or feature state. It is excluded from every RTP
figure above; no gamble RTP claim is made by this task.

## 8. Reproducing this evidence

Requires Node 24, PHP 8.0 (XAMPP) and network access only for the client-hash check.

```text
node docs/agent-work/lucky-lady-runtime/math/extract-rules.mjs
node docs/agent-work/lucky-lady-runtime/math/oracle-extract.mjs
node docs/agent-work/lucky-lady-runtime/math/test-vectors.mjs
node docs/agent-work/lucky-lady-runtime/math/simulate.mjs --profile=raw --rounds=1000000 --seed=raw-baseline-1 --out=raw-baseline-1m.json
node docs/agent-work/lucky-lady-runtime/math/calibrate.mjs --scan --rounds=1000000 --other=10 --values=99,99.5,100,100.4 --tag=window-family-fine4
node docs/agent-work/lucky-lady-runtime/math/freeze.mjs --freeze
node docs/agent-work/lucky-lady-runtime/math/freeze.mjs --validate --rounds=1000000 --seeds=validation-a,validation-b,validation-c,validation-d,validation-e,validation-f,validation-g,validation-h,validation-i,validation-j,validation-k,validation-l,validation-m,validation-n,validation-o,validation-p,validation-q,validation-r,validation-s,validation-t
node docs/agent-work/lucky-lady-runtime/math/verify-untouched.mjs
```

Simulation is deterministic: `createRng(seed)` is an explicit injected interface, so the same seed
reproduces the same result exactly.

## 9. Runtime and client left untouched

`math/verify-untouched.mjs` compares all recovered client files against the pinned upstream Git tree
at `heidi-luong1109/game@1eb3234892790d0c4ded54233f369aff176d9d8d` using Git blob hashes:
**185/185 files match, 0 mismatches, 0 extra** (`math/runs/untouched-verification.json`). The
accepted runtime shim files (`compat.php`, `router.php`, `recovery.php`, `recovery-client.js`,
`real-methods.php`) are hashed in the same evidence file and were not modified by this task.
`git status` in the worktree shows only new files under `docs/agent-work/lucky-lady-runtime/math/`
plus this document and the pre-existing untracked plan/report files.

## 10. Limitations

- Raw strips with uniform stops produce approximately 466% RTP in this model. The validated
  profile changes the underlying stop distribution; it does not use the excluded conditioning.
- The frozen 50 % profile reaches its target by making feature triggers rare (~0.055 % of paid
  rounds). All symbols and features remain possible and the free-spin process is provably
  subcritical, but the feature frequency is far below the original code's forced-scatter behaviour.
- Only `bet = 1, lines = 10` was validated. Payouts scale linearly with stake within safe integer
  ranges. Different line counts can change RTP and have not been independently validated.
- The freeze gate was met at 20M rounds. The 6M interim sample had a point estimate inside the band
  but a CI lower bound of 49.3726, i.e. 0.13 pp short; the contract's remedy is more samples rather
  than a wider tolerance, and the tolerance was not widened.
- Monte Carlo evidence is not a regulatory certification, and the reported RTP is not an exact
  analytical value.
- The oracle and the engine are mathematically independent implementations, but both were ported by
  the same author from the same source; the oracle reduces, but cannot eliminate, shared-misreading
  risk. Every oracle comparison is against executed original code, not a second copy of the engine.
