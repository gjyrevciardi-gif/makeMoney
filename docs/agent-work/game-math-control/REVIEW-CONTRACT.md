# Game math control: acceptance contract

Root review contract, 2026-10-01. Implementation continues the preserved, uncommitted adapter extraction on `integration/game-adapter-template`, HEAD `e62e747`. The pre-task diff and untracked files are preserved outside Git at `C:/Users/Admin/orca/research/game-math-control-baseline`. Neither the extraction nor this phase is accepted merely by being present.

## Boundaries

- Shared code owns validated policy, immutable artifact identity, evidence, admin authorization, global per-game activation and auditing. Adapters own reachable outcomes, generation, evaluation and protocol translation.
- Pacing describes a stationary probability distribution; it never schedules losses or wins from player history. Generation and profile selection have no player inputs.
- Accepted Lucky Lady evaluator, rules, client and `lucky-lady.rtp50.v1` stay unchanged. Accepted canonical profile hash: `eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f`.
- New paid rounds snapshot a validated immutable reference. Prepared outcomes, features, gamble and recovery retain that reference through activation/restart. A generated outcome is never truncated, discarded or redrawn to meet a policy.
- Unsupported constraints produce explicit inactive/rejected results. Monte Carlo cannot prove maximum support or true RTP zero.

## Mathematical acceptance

For multiplier random variable X, RTP is E[X], hit rate is P(X > 0), partial return is P(0 < X < 1), loss rate is P(X < 1), and break-even is P(X = 1). Loss rate includes partial returns; it is not the zero rate. With a hard bound M, E[X] <= M * P(X > 0). A policy violating this bound is infeasible regardless of calibration.

The supplied example has total probability 1 and expected multiplier 1. Its weighted terms are 0.15 + 0.12 + 0.10 + 0.24 + 0.12 + 0.12 + 0.15. This proves only that example's arithmetic, not its reachability in any game.

Max-win support depends on the declared scope. The current scope is **RESOLVED_SPIN**: each individual paid-spin or free-spin resolution must be at or below the ceiling times the locked originating paid stake, and the feature chain with its retriggers aggregates without a ceiling. That is why a finite per-resolution bound stays compatible with an indefinitely repeatable paying retrigger: the bound is on one resolution, never on the sum. A simulation safety exception is still not a valid payout cap.

The legacy scopes keep their whole-round meaning: `PAID_ROUND_BEFORE_OPTIONAL_GAMBLE` bounds the complete paid round excluding the optional gamble, and `TOTAL_INCLUDING_OPTIONAL_GAMBLE` is the scope that would have to include repeated gamble doubling - which no finite ceiling can bound, so it is refused. Profiles without `maxWinEnabled` are legacy and are neither reinterpreted nor granted a `RESOLVED_SPIN` guarantee.

Independent validation must exercise the same authoritative math consumed at runtime, bind its evidence to the immutable profile hash, distinguish calibration from validation, and report sample size and uncertainty. Every explicitly requested policy constraint must either be verified or fail validation. A sampled maximum alone is never a support proof.

## Bankroll accounting

The standard simulation starts at 100 PTS, with 0.20 PTS per paid round. Exact normalized units may be used without changing the live whole-point stake ladder. Wins are credited and recyclable. Free spins consume no further wager. Paid-round turnover is completed paid rounds times 0.20 PTS.

Reference fixtures, separate from production profiles:

| Constant return | Paid rounds before ruin | End balance | Turnover |
| --- | ---: | ---: | ---: |
| 0x | 500 | 0 PTS | 100 PTS |
| 0.5x | 999 | 0.10 PTS | 199.80 PTS |
| 1x | No ruin at finite horizon H | 100 PTS | 0.20H PTS |

A 2x fixture reaches 125/150/200 PTS after 125/250/500 completed paid rounds. Its completed-round peak-to-trough drawdown is zero. These are exact accounting oracles, not proposed game profiles.

`Alive@N` means the bankroll can fund another wager after N paid rounds. Ruined balances retain any dust. Checkpoint averages include all sessions and carry terminal balances forward; conditioning only on survivors would bias them. Unobserved checkpoints beyond the horizon are missing, not zero. Horizon survivors are right-censored. Restricted observed-duration statistics must be labelled; they are not estimates of exact eventual bust time. Threshold reach and drawdown use a documented observation convention. Percentiles use a documented, tested convention.

Session results require independent streams, declared horizon/sample size, profile hash and immutable JSON/Markdown evidence. Aggregate RTP is total return divided by total paid wager; ending bankroll divided by starting bankroll is not RTP.

## Activation and regression gate

Activation requires server-produced math PASS, support/max PASS, completed bankroll evidence, matching frozen artifact hash, administrator authorization, durable game-global activation and concurrency protection. No trusted client-provided validation. Requested-but-infeasible comparison targets must remain labelled as such.

Review includes authorization, profile locking, no outcome targeting, exact accounting, reproducible statistical evidence, and retained Lucky Lady auth/launch/wallet/ledger/replay/features/recovery/IDOR/browser behavior. No acceptance or commit is inferred from a worker completion message.

## RESOLVED_SPIN max-win scope (2026-10-02)

The user chose **RESOLVED_SPIN**, not RESOLVED_EVENT.

- The advertised `maxWinMultiplier` is a ceiling on each individual mathematical resolution: one paid spin, or one free spin with the feature multiplier applied. Both are measured against the **locked originating paid stake**; a free stake is never treated as zero.
- The feature chain and its retriggers aggregate **uncapped**. No outcome is truncated, retruncated or redrawn to fit the ceiling, and the ceiling is never re-derived from a sampled maximum.
- Supported by proof, not observation: a `RESOLVED_SPIN` profile is proved from exact enumeration of the reachable boards (paid maxima, and free-spin maxima with the engine's own feature multiplier). The engine's 20000-spin safety exception is still not a payout cap.
- Activation gates are unchanged: the resolved-spin proof is one required check among the existing evidence, grade and ledger checks. The whole-round identity `E[X] <= M * P(X>0)` is deliberately **not** asserted under this scope, because one round may resolve many individually bounded spins.
- `maxWinEnabled` is explicit metadata on a new profile. **Absent means legacy**: nothing is reinterpreted, no `RESOLVED_SPIN` guarantee is claimed, and the canonical hash of an artifact that never carried the field does not move.
- `PAID_ROUND_BEFORE_OPTIONAL_GAMBLE` and `TOTAL_INCLUDING_OPTIONAL_GAMBLE` keep their previous semantics and hashes. The optional red/black gamble is excluded by `PAID_ROUND_BEFORE_OPTIONAL_GAMBLE` and by `RESOLVED_SPIN`; it is exactly what `TOTAL_INCLUDING_OPTIONAL_GAMBLE` includes, and that scope stays refused because the doubling has no attempt cap.
- A round is pinned to the profile identity and the cap it was opened under: `LuckyLadyState.maxWin` is written once, at the new paid round, and every later action - free spin, retrigger, gamble, recovery and replay - reads it from the stored state instead of the active profile. A later activation therefore cannot re-cap an existing round, its pending feature, its prepared outcome or a stored replay result, and a legacy round keeps `maxWin: null` rather than being back-filled.
- Validation-vs-live limitation: this phase proves the mathematical support and the boundary arithmetic with the real engine. It does not run the HTTP protocol, the database, the browser harness or a live activation; those are covered by the integration and evidence suites.

### Astra acceptance — RESOLVED_SPIN only (2026-10-02)

**ACCEPTED for this bounded scope contract, validation and round-metadata wiring.** This does not accept the whole uncommitted candidate or authorize activation of a generated profile.

- Focused worker run: `node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand test/lucky-lady.max-win-scope.spec.ts test/game-math-control.spec.ts` from `backend`: 54 tests passed. No database, browser or full suite was run.
- Independent Astra boundary probe injected synthetic support maxima into the real validation branch at a fixed 50x cap: 49.99x PASS, 50x PASS, 50.01x FAIL. Separate focused tests enumerate real reachable boards with the accepted evaluator; synthetic decimal boundary inputs are not claims of native board reachability.
- Independent Astra probes drove the actual adapter through in-memory platform ports with the unchanged engine and deterministic test RNG. Using reachable stops from the `[67,51,13,33,33]` / `[63,119,102,60,108]` support, a 15-free-spin chain returned 705x and a retriggered 30-spin chain returned 1413x in aggregate. Every paid/free-spin payout was individually at most 50x of its locked originating paid wager.
- During both features the active pointer was switched from 50x to 20x. The stored 50x pin, main board and complete feature sequence remained unchanged through feature presentation and recovery; repeating the original paid action returned the identical stored response, consumed no further RNG draws and created no second round. The focused new-round test separately verifies that the next paid round snapshots 20x.
- No post-generation payout cap, truncation, retrigger suppression or gamble change was added. Legacy scope values retain their meanings; absent historical cap metadata is not back-filled from the current active profile. Bankroll, analytics, rational conversion and report formatter hashes remained unchanged throughout this phase.
- Evidence is bounded to deterministic validation and adapter tests with in-memory ports. HTTP/database/browser deployment acceptance and the wider payout-distribution phase remain separate work.
