# Automatic policy generator: Astra review checkpoint

## Latest decision — bounded root closure accepted

**ACCEPT for the four-blocker closure authorized by the user.** Astra implemented and reviewed the fixes directly after Flash's HTTP 402. No provider retry or other worker was used. See [CLOSURE.md](CLOSURE.md) and [closure-integrity.json](closure-integrity.json) for the current evidence. The earlier rejection below is retained as audit history, not the current verdict on these four blockers.

The exact triple is now found, every hard minimum/maximum is enforced, MaxWin is explicit in requests with separately proved 20x/50x supports, and unproved search misses return `SEARCH_EXHAUSTED`. RTP70 volatile is statistically compatible with its existing expectation and was not retuned. All 16 focused tests and the focused TypeScript check pass.

This is offline bounded-generator acceptance, **not activation approval**. The prior lifecycle/report-format observations outside the user's four-item closure were not expanded in this task. No profile or runtime default has been activated or changed.

## Earlier review (superseded for the four corrected blockers)

**REJECT — not accepted.** Flash wrote a partial candidate, then its provider returned HTTP 402 (insufficient DeepSeek balance). No provider retry, fallback model, activation, commit, or merge was performed. The existing worktree and uncommitted work remain preserved.

The automatic `VALIDATED` labels in the generated artifacts are implementation output, **not Astra acceptance**. They must not be used as approval to activate a policy.

## Files left by the implementation

- `backend/src/casino/platform/math-control/payout-policy-generator.ts`
- `backend/src/casino/games/lucky-lady/lucky-lady.policy-generator.ts`
- `backend/test/payout-policy-generator.spec.ts`
- `backend/scripts/payout-policy-generator-evidence.mjs`
- JSON/Markdown artifacts in this directory (eight candidates, model and comparison).

## Verified evidence

Astra ran only `node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand test/payout-policy-generator.spec.ts` from `backend`: **10 tests passed**. No database connection, browser, full backend suite, or new large simulation was run for review.

Independent artifact checks confirm that all eight saved samples use 100 PTS / 0.20 PTS, exactly reconcile opening balance + payouts - paid wagers = closing balance, have weights summing to 1,000,000, and report zero native-class mismatches and no activation. Expected RTP is within each saved sample's approximate 95% RTP interval. The saved sample plan is 80 sessions with a 5,000-paid-spin horizon per candidate.

The RTP70 artifacts demonstrate different distributions: retention has approximately 1.00% full losses and 71.53% partial returns; volatile has approximately 94.11% full losses and 1.00% partial returns. Their analytical RTPs are 70.000045% and 69.999604%. This evidence does not resolve the generator defects below.

The accepted bankroll, analytics, rational arithmetic, selector, native distribution adapter, runtime adapter, and golden RTP50 artifact hashes still match their recorded accepted values. The new bounded model is explicitly distinct from the dense golden RTP50 model.

## Consolidated correction findings

1. **Required request contract is absent.** A request containing `gameId: 'lucky-lady'` and `maxWinMultiplier: 50` is rejected (`UNKNOWN_FIELD`, `UNSUPPORTED_CONSTRAINT`). MaxWin is hardcoded in the adapter. Provide the requested game/target/MaxWin/pacing contract, with honest refusal for unsupported model/cap combinations rather than rejecting the required 50x input itself.

2. **Three-class solver rejects a demonstrably feasible point.** Independent generic exact fixture: conditional EVs `0`, `1/2`, `2`; granularity `4`; target `75%`; tolerance `0.01pp`; weights `1,2,1` give exactly `(0 + 2*(1/2) + 2)/4 = 0.75`. `solvePayoutPolicyWeights` nevertheless returns `INFEASIBLE`. In `tInterval`, division by a negative step requires reversing the inequality endpoints; normalizing the rational denominator alone does not do this. Add this deterministic regression. Search-family exhaustion must also be distinguished from a proved infeasibility result.

3. **Contradictory bounds can be marked VALIDATED.** Independent Lucky Lady request: target `70`, minimum `PARTIAL_HIGH=0.02`, maximum `PARTIAL_HIGH=0.001`. The generator returns `VALIDATED` with `PARTIAL_HIGH=20,000` of 1,000,000 units, exceeding the allowed maximum of 1,000. The solver checks caps on selected residual classes but not all floor-only classes, and final validation checks minima but not maxima. Reject contradictory bounds and validate every resulting class against both bounds before assigning any successful status.

4. **Hard diversification floors reject otherwise feasible low targets.** Target `1% / RETENTION` is returned as `INFEASIBLE` because every positive request silently acquires 1% floors on LOSS, PARTIAL_HIGH and SMALL. These are pacing preferences, not caller requirements; they must yield when incompatible with the requested target. For the declared model, a LOSS/PARTIAL_LOW mixture can reach approximately 1% on the existing grid. Keep mandatory mixed behavior for the requested RTP100 case without imposing these hard floors on every positive target.

5. **Validation lifecycle is premature.** `generateLuckyLadyPolicy` returns `VALIDATED` before any bankroll run. The required lifecycle must reserve the completed validation status for a candidate with the requisite analytical, game-specific and behavior evidence. Do not allow an analytical-only result or a failed/insufficient evidence run to imply completion of that gate.

6. **Generated Markdown loses required reporting details.** The new formatter uses an ambiguous `Balance mean` header without the conditional checkpoint denominator, despite the accepted report convention. It also omits explicit expected house edge, median house result and full-loss P95 from the human-readable summary. Reuse/preserve the accepted labels and include these existing metrics rather than changing accounting or recalculating them.

## Resume boundary

No implementation correction was dispatched after the provider error. One focused correction pass remains available once the authorized Flash route is usable. Address this consolidated list in the four new implementation/test/runner files and their generated artifacts only; preserve the accepted math, policies, simulator, conditional reporting implementation and runtime. Then rerun the affected focused tests and have Astra review the corrected evidence. Do not restart from baseline or commit the full candidate.
