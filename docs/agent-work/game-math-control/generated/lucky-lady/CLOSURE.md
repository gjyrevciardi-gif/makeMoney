# Bounded generator closure

**Astra decision: ACCEPT within this task's four-blocker scope.** No activation, commit, new worker, provider retry, browser, database integration, or full suite. Existing artifacts were preserved instead of regenerating all candidates.

## Feasibility and hard bounds

`payout-policy-solver.v1.1` fixes the sign reversal in the three-class Diophantine solver's interval bounds. Conditional EVs `0, 1/2, 2`, grid `4`, target `75%` now produce weights `1,2,1`, exactly 75%.

Every candidate is checked against every minimum and maximum, including classes receiving only their floor allocation. Final validation also checks all maximums. Contradictory `PARTIAL_HIGH >= 2%` and `PARTIAL_HIGH <= 0.1%` now returns `INFEASIBLE` with `MINIMUM_EXCEEDS_MAXIMUM`; it cannot return a validated policy. A native target70/VOLATILE request with `constraints.maxFullLossRate: 40` and a stricter `maximumWeightFraction.LOSS: '0.3'` respects the 30% bound regardless of property order. This percentage shorthand supplements the existing exact fractional class bounds.

Proven infeasibility uses exact evidence: unreachable positive floors, contradictory bounds, total minimum above 100%, total maximum below 100%, or target outside the exact attainable EV interval. Integer minimum/maximum EV witnesses are derived by filling residual capacity in EV order. True RTP0 uses zero tolerance, so even a tiny unavoidable positive expected return is infeasible.

An unproved search miss returns `SEARCH_EXHAUSTED`, never `INFEASIBLE`. The regression with four classes `0, 1/2, 1, 2`, grid4, each capped at 25%, target87.5% has a known four-class solution beyond the bounded residual-support search and explicitly reports that distinction. A request bound to the wrong game/model cap returns `REJECTED / MODEL_REQUEST_MISMATCH` rather than a feasibility claim.

Default pacing floors remain preferences: if they prevent a solution, one bounded retry removes only those preferences while preserving all caller bounds and explicit `requirePositive*` constraints. Target1% now succeeds. Valid existing single/pair policies are preferred over the repaired triple fallback, preserving all eight saved policies' weights and canonical hashes.

## Explicit MaxWin

The public Lucky Lady request accepts `gameId`, `targetRtp`, `maxWinMultiplier`, and `pacing`; existing `targetRtpPercent`/`objective` names are supported as alternatives, not simultaneous duplicate fields. MaxWin is required—an omitted cap is rejected. The game-specific entry point supplies its own game id when omitted, but rejects another game's id. The generic solver requires its model and request game/cap bindings to agree.

- **50x:** existing 108-board model, profile hash and all eight distributions unchanged.
- **20x:** a separately named/hashed pre-draw support reuses the already proved loss/partial/small stop combinations. It is enumerated under the requested 20x scope, not filtered after generation. Its reachable paid maximum is 5.4x. Every enumerated hypothetical free-spin payout is also checked against 20x; this bounded model has no reachable feature trigger. A positive feature minimum is therefore infeasible under this model, not a claim about all possible Lucky Lady models.
- Other caps are explicitly `REJECTED / GENERATOR_MODEL_UNSUPPORTED` in this bounded implementation, never silently replaced by 50x.

Native selected-outcome checks and full support enumeration prove no truncation. The only new session simulation is [closure-maxwin20.json](closure-maxwin20.json): 80 sessions, 5,000 paid-spin horizon, seed prefix `closure:maxwin20:rtp70:v1`, 100 PTS / 0.20 PTS. Expected RTP70.000020%, measured70.250015%, approximate95% CI69.818813–70.681217%. Existing accounting and outcome modules are unchanged.

## RTP70 volatile — keep the original candidate

| Metric | Saved evidence |
| --- | ---: |
| Expected RTP | 69.9996036178% |
| Measured RTP | 68.8919594274% |
| Standard error | 0.9186095804 percentage points |
| Standardized difference | -1.205783408 |
| Approximate 95% CI | 67.091517734–70.692401121% |
| Sessions | 80 |
| Paid spins | 128,461 |
| Free spins | 0 |
| Horizon | 5,000 paid spins |
| Horizon-censored sessions | 0 |

The expectation lies inside the reported interval; the difference is approximately 1.21 standard errors. **Statistically compatible**, not evidence of an EV, selector, or simulator defect. No features/retriggers occurred or carried policy weight in this candidate, so feature variance does not explain this run. The rare-paying volatile distribution has higher return variance. All sessions ended before the horizon; the existing optional-stopping caveat still applies to the normal approximation. No weight, seed, payout, or sample-size tuning was performed.

## Focused validation and preservation

From `backend`:

`node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand test/payout-policy-generator.spec.ts`

**16 tests passed.** A TypeScript program rooted only at the two changed generator modules and their test reported **zero diagnostics**. The focused suite includes all requested closure cases, no player-shaped request inputs, determinism, native MaxWin20 enumeration, exact hard caps, honest search exhaustion, and the saved volatile confidence check.

[closure-integrity.json](closure-integrity.json) records byte-identical preservation of **82 protected source files** and **16 original candidate report files**. The golden RTP50, CSPRNG selector, bankroll accounting, conditional checkpoints, policy locks, wallet/ledger and native evaluator remain untouched. HEAD remains `e62e74746af110f9cedf29a3e08859d5be453a5a` on `integration/game-adapter-template` with all work uncommitted.

Changed product/test files are limited to the two new generator modules, their focused test, and the offline runner (now supplies an explicit 50x request). Existing eight reports and the comparison are unchanged; only closure evidence and the new MaxWin20 report were added, plus this review update. Other earlier lifecycle/formatting improvements are outside this explicitly bounded task.
