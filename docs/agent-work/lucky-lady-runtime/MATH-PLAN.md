# Pure Lucky Lady math / RTP50 contract

Baseline `5592edb`; runtime and recovered client are read-only. Pre-existing untracked `RTP-RNG-PLAN.md` and `RTP-RNG-REMEDIATION.md` belong to the rejected prior attempt and must remain untouched and outside this task's commit.

One Flash worker owns new `math/` implementation/data/tests/simulation artifacts and `MATH-MODEL.md` under this documentation directory. Astra owns this contract, acceptance review and any accepted commit. Do not modify `harness/`, deploy scripts, external active runtime, databases, recovery, client or other games. Read the pinned ORIGINAL backend, not the rejected patched copy.

## Architecture and proof

Trace original source with file/line references and hashes. Separate board generation/evaluation/feature mechanics from category targeting, forced scatter placement, bank/stat/history/financial logic. The raw baseline is explicitly defined as uniformly drawn original reel stops with native legitimate payout/feature rules; document stop wrapping and any ambiguity in the original filtered generator. No payout-category sampler belongs in the pure model.

Use a standalone efficient module (e.g. Node or equivalent available runtime, no dependencies/install required): pure board evaluation plus complete-round generation with an injected RNG. The latter draws each stop once from immutable profile weights, evaluates once, and follows legitimate feature state. No DB/user/shop/wallet/HTTP/network dependencies. Use integer payout units and explicit stake/unit conversion. Return board, paylines, base/scatter wins, feature spins/retriggers and total payout; simulator may aggregate without retaining millions of boards, but must call the same evaluator/generator.

RNG is an interface only; deterministic seeded generator for reproducible simulation and explicit draws for vectors. Any future production CSPRNG adapter remains disconnected from runtime. Unbiased bounded sampling (including shuffle if needed), documented algorithm/seed. No runtime fixture controls.

Before calibration, execute deterministic vectors against an independent reference from the pinned original evaluator, not a second copy of the new algorithm. A narrowly extracted original PHP payout/feature block in an external test-only oracle is acceptable; preserve source hashes/line ranges and extraction checks. Never boot or alter the working runtime for this. Cover no-win, ordinary line, leading/all/mixed wilds, scatter counts/trigger, simultaneous line wins, 15-spin award, multiplier, retrigger 15→30 and cumulative feature accounting. Zero unexplained mismatch.

## Measurement and calibration

Measure original-strip uniform-stop raw math over at least 1,000,000 completed paid rounds including all free spins/retriggers. No discarded/truncated feature chains; resource limits fail a run, never count partial returns. Record all requested metrics, sample variance, 95% confidence interval, seed, run ID, profile hash and evaluator/input hashes. Explicitly document denominators and separate base line/scatter from feature totals to prevent double counting. Gamble excluded and its reason stated.

Only after reference proof, calibrate ONE RTP50 candidate through documented parameter search over pre-outcome reel strips/independent stop weights or legitimate feature frequencies. No selecting a win/loss category, no forced-loss fallback, no outcome rejection. Preserve paytable, line/wild/scatter mechanics and free-spin rules. Keep all recognizable symbols and features possible. Save calibration trials and search method; do not hand-label a guessed target.

Freeze `lucky-lady.rtp50.v1` and its canonical hash before independent validation with new seeds, minimum 1,000,000 paid rounds. Acceptance: observed RTP within 50.00% ±0.50 percentage points AND a sufficiently precise 95% interval contained within that range. Run more if necessary; do not widen tolerance or tune on final validation. If candidate fails, distinguish calibration revision from new independent validation and retain honest evidence. State validated bet/line configurations; do not claim untested configurations have the same target.

Tests also establish purity, deterministic repeatability, one stop draw per reel per spin/no payout retries, weights validity, feature completion/accounting, source-reference agreement and unchanged runtime/client hashes. No browser/runtime compatibility rerun is needed because integration is forbidden.

## Delivery / stop

`MATH-MODEL.md` contains exact rules/provenance, legitimate versus excluded functions, reference evidence, raw and RTP50 measured metrics, calibration trail, reproducibility commands, profile hash and limitations. Keep compact source/data/test/results in Git; third-party source/oracle and bulky artifacts stay external. Do not import complete casino source. No success claim or activation if evidence fails. Do not commit: Astra commits only after acceptance using `feat: validate Lucky Lady clean math and RTP50 profile`.
