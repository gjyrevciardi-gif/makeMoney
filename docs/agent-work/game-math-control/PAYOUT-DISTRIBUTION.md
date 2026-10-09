# Global payout distribution core - evidence

Scope of this phase: the distribution model, its validation, its reachability
proof against the real Lucky Lady engine, and selection over pre-validated
outcomes. No UI, no database, no target-RTP generator, no changes to the
accepted math, the frozen RTP50 profile or the gamble.

## Classes (Model A, mutually exclusive)

| Class | Meaning |
| --- | --- |
| `LOSS` | X = 0 |
| `PARTIAL_LOW` | 0 < X < 0.5 |
| `PARTIAL_HIGH` | 0.5 <= X < 1 |
| `BREAK_EVEN` | X = 1 |
| `SMALL` | 1 < X < 5 |
| `MEDIUM` | 5 <= X < 20 |
| `BIG` | 20 <= X < `maxBandMin` |
| `MAX` | `maxBandMin` <= X <= `maxWinMultiplier` |
| `FEATURE_TRIGGER` | the paid board triggers the feature (3+ scatters) |

Ordinary bands exclude triggering boards; the trigger is its own class whose
payout is the triggering board's native paid return plus the conditional
whole-chain feature expectation. `maxBandMin` is immutable and at least 20, so a
ceiling below 20 makes the high bands unreachable and any positive weight there
is rejected instead of overlapped. Weights are exact non-negative integers on an
explicit granularity and must total exactly 100%; the canonical identity binds
policy id/version, math profile id/hash, the `RESOLVED_SPIN` ceiling, the bounds
and the weights, and rejects player, session, balance, history and seed fields.

## Reachability and expected value

`buildDistributionSupport` enumerates the profile's real reachable boards with
the accepted evaluator (`enumerateBoardOutcomes`), classifies each one, and
computes every conditional expectation exactly from that enumeration - including
the feature chain (`15 / (1 - 15p)` expected free spins x exact per-free-spin
expectation). It refuses, rather than approximates: a support that is too large
to enumerate, a class with weight but no reachable member, a per-resolution
maximum above the `RESOLVED_SPIN` ceiling, and a divergent or unknown feature EV
(`CLASS_EV_UNKNOWN`) - which is exactly what happens for a profile whose every
board triggers.

## Selection and randomness

Selection draws a class from the exact integer weights and then a board from the
class's real pre-draw masses, so the outcome is already inside the proved
support: no rejection sampling, no truncation, no redraw. Production uses
`crypto.randomInt` through `createCryptoMassSelector`, which takes no seed;
determinism lives in a separate factory that only tests construct. The selected
reel stops can be forced for the initial paid draw while every later draw
(free spins and retriggers) is delegated to the same native math - the focused
test executes exactly that and the engine reproduces the locked profile's
feature chain.

## Verified here

Focused run, from `backend` with the existing dummy `*_test` `DATABASE_URL`
guard and no database connection:

```
node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand \
  test/payout-distribution.spec.ts test/payout-distribution-runtime.spec.ts
→ Test Suites: 2 passed, 2 total
→ Tests:       25 passed, 25 total
```

That is 19 core tests plus 6 runtime/regression tests. The retained
`test/lucky-lady.max-win-scope.spec.ts` (11 tests) is unchanged and was not
rerun in this pass. The core suite proves each canonical class with real boards,
`LOSS` 100% selecting only zero-return scatter-free boards, `SMALL` 100% staying
strictly inside (1,5), a seeded 50/25/25 mixture within +/- 5pp at n = 2000 with
every selected board confirmed by the engine, the exact 50/25/25 cumulative
boundaries, rejection of 99.99%/100.01% totals and of negative/NaN/non-finite
weights, unreachable classes, the per-resolution cap including the paid/free
dimensions, the feature-chain EV and native execution on the *same* support
payload, the exact EV of a real loss/small/big mixture from an independent
enumeration, entry-validation and frozen-policy immutability, identical and
concurrent selections, and bounded OS randomness above 2^48 and 2^96.

## Runtime wiring (opt-in, no new store)

The operator-facing switch is the existing immutable game configuration. A
server-only envelope in `gameSpecific` may carry `distributionPolicy` (the exact
Model A policy document) and an optional `distributionPolicyHash` that must match
the policy's own canonical hash. When it is present, the adapter's new paid round
validates it, binds it to the SAME pinned active math artifact (profile id +
hash) and its `RESOLVED_SPIN` cap, proves the reachable support, selects one
class and one real board, and then executes the native math with a wrapper that
forces only the initial five stop draws and delegates every free spin and
retrigger to the original generator and the same profile. The class selection is
persisted once, in the round's existing opaque `privateState`
(`policyId`/`policyHash`/`selectedClass`), and free spins, gamble, recovery and
replay read that stored state - they never re-select and never re-look-up the
global policy. When the envelope is absent (or on a legacy round with no pin) the
accepted path is byte-equivalent and `distribution` is `null`.

Verified with serialized in-memory platform ports (no database): concurrent
identical requests produce one class selection, one native generation, one
prepared outcome and one debit with identical responses; a request replayed after
a JSON reload returns the stored response without drawing; a policy switch A to B
keeps the earlier round's pin and uses B only for the next paid round; and a
settlement failure leaves the prepared outcome intact so a reloaded harness
settles it without a second selection, generation or debit. This harness has no
database, no HTTP surface and no replay API: it demonstrates the stored-row
contract, not database durability.

## Fixture hash semantics (corrected)

The original runtime fixture hashed an abbreviated
`{maxWinScope, maxWinMultiplier, maxBandMin}` stub while the artifact it was
attached to carried a whole `MathPolicy` (`gameId`, `targetRtpPercent`,
`maxWinEnabled`, `pacing`, `customPacing`, `hitRate`, `partialReturn`,
`volatility`, `bigWinMin/MaxMultiplier`, `featureContribution`, `presets`) and no
`maxBandMin` at all, so `canonicalProfileHash(artifact)` could never equal the
stored `artifact.canonicalHash`. The regression keeps that bug as a **reproducer**
rather than deleting it: with the original payload (LOSS `[120,58,23,5,116]` and
SMALL `[38,61,49,73,122]`, weight 1 per reel) and
`profileId = 'lucky-lady.test.runtime-fixture'`, the stub policy hashes to
`a9807055...f7370b` and the real artifact hashes to `99bf4dea...8d66ee` - both
asserted as anchors while the corrected value is still *derived* from the final
artifact through the existing `canonicalProfileHash`.

The two artifacts differ only in the hash input's `policy` (and, for the buggy
reproducer, the stored `canonicalHash`): identity, engine hash, rules hash and
payload are asserted identical, and the two payload objects are independent deep
copies. A seeded engine run consumes the actual before/after payload objects and
asserts the full round (board, main evaluation, feature sequence, total win) *and*
the complete RNG draw trace are equal. A separate assertion shows the artifact
hash is invariant to key order while `distributionPolicyHash` is invariant to
reordered weights, repeat-stable, and moves only for a changed `policyId`
(without touching the artifact hash or payload). The mock `activeProfile` port
recomputes `canonicalProfileHash(artifact)` and throws when it differs from the
declared hash, so an inconsistent fixture cannot pass silently.

## Persistence, reload and selector counts

`test/payout-distribution-runtime.spec.ts` serializes the mutable port state
(rounds, prepared rows, action responses with their canonical keys, wallet test
state) to JSON and rebuilds a **fresh adapter with fresh port objects** from
those rows - no live references, no shallow-copied maps, `BigInt` balances kept
as decimal strings on the wire.

Policy A is a sparse native fixture whose **only** triggering board is the 50x
ceiling board (scatters are additive per reel here, so `FEATURE_TRIGGER` has one
reachable member and the class draw resolves to a single deterministic paid
board). It opens a paid round that resolves the whole feature chain from a
scripted test stream: one real retrigger followed by 29 dead spins - the engine
resolved 30 spins, the adapter's client-visible award grows 15 -> 30. The stored
pin is asserted immediately before and after the JSON reload as the complete
contract: `selectedClass`, `policyId`/`policyHash`, `profileId`/`profileHash`,
and `maxWin {profileId, profileHash, maxWinEnabled: true,
maxWinScope: 'RESOLVED_SPIN', maxWinMultiplier: 50}`, plus the frozen paid board,
main win, payout and sequence length.

The global configuration then switches to policy B on a different honest
artifact (cap 20) while the in-flight round continues holding A. Direct
`jest.spyOn` instrumentation of the shared `selectDistributionClass` (imported as
a module namespace: `import * as core`, not the game wrapper) and of
`generateCompleteRound` shows exactly one class selection and one native
generation for the round, and **zero** of either during the first free spin, the
replay of that same request, the remaining 29 free spins, a `getSettings`
recovery read, and a collect. Each of the 30 free resolutions is asserted to keep
the originating `policyId`/`policyHash`, `profileId`/`profileHash` and 50x
`RESOLVED_SPIN` pin. A dedicated counter proves no `activeProfile` lookup happens
while the feature executes; `getSettings` is allowed one read to report the
separately-active maths, and its `recovery` still serves round A's stored
presentation. The first free spin also proves the replay contract: the identical
request id returns the identical response and the round stays at 30 total / index
1. A subsequent new paid round pins policy B and its own artifact at cap 20, and
the prepared/reload test proves a failed settlement's stored payload survives a
reload and settles with no second selection, generation, draw or debit.

## Limitations

- The envelope lives in the immutable game configuration and is read through the
  existing `assertPlayable` path; there is no admin editor, no activation API and
  no new database table in this phase.
- Support must be enumerable within the bounded limit (4096 boards here); a
  denser profile is refused rather than approximated, and no claim is made about
  the frozen RTP50 profile's entire support.
- Test fixtures use an honest test-artifact id and a real `canonicalProfileHash`
  over the test payload - never the golden dense profile's hash.
- The production selector draws from the OS CSPRNG in 47-bit chunks (the largest
  `crypto.randomInt` bound), is unbiased by rejection over the random value and
  has no seed parameter; deterministic selection exists only as a separate
  test-only factory.

## Astra review status — ACCEPTED (bounded payout-policy core)

No commit, activation, database run, browser run or broad test suite was
performed in this phase. Both previous evidence blockers are closed. Astra accepts the bounded payout-policy core after reviewing the saved regressions and independently probing reload behavior. This does not accept or commit the entire wider candidate.

### Independent probes already recorded by Astra

- Astra independently drew 128 OS-CSPRNG samples over masses through 333 bits,
  checked all six exact CDF endpoints for the 50/25/25 example, verified EV=3/4
  for conditional payouts 0/1/2, and rejected 50.01x under a 50x ceiling.
- Astra instrumented the distribution selection inside the actual
  `LuckyLadyAdapter` using serialized in-memory ports: concurrent identical bets
  plus replay produced one selection, one RNG factory invocation, one debit
  invocation and equal authoritative responses.
- With a correctly canonical-hashed sparse native-math fixture, Astra exercised
  a real trigger and one deterministic TEST-only retrigger. All 30 free spins
  retained policy A after global policy B was selected; retrigger replay stayed
  15 -> 30 -> 30, recovery added zero selections or draws, and the next paid
  round used B.
- A separate real-outcome fixture mixed LOSS, PARTIAL_HIGH, SMALL, MEDIUM and
  BIG at 20% each across 2500 reachable boards. Exact expected return was
  98630367/13858000 (711.721511% RTP): high return can coexist with losses and
  partial returns. It is neither an activated profile nor a claimed 100%-RTP
  calibration.
- Protected bankroll, analytics, rational and exact-report files retain their
  previously accepted SHA-256 hashes. The golden RTP50 profile file retains
  14A5F695611AEBD33B0F27F7894731B5E0E03934FC2261366598F84A0314BB65.

### This correction pass

Test-and-doc only: no product source was changed. The hash regression now keeps
the original bug as a reproducer with both hashes anchored and the corrected hash
derived from the final artifact; the runtime tests instrument the shared
`selectDistributionClass` directly and assert the complete originating pin
(policy, class, math profile, cap) across a JSON reload and all 30 free
resolutions; the prepared/replay evidence now performs its replay after the
reload. Focused result: 25 passed (19 core + 6 runtime), command and output in
"Verified here" above. Dense supports above 4096 boards remain explicitly
unsupported and fail closed; the golden dense RTP50 distribution was neither
enabled nor modified.

### Final Astra acceptance evidence

- Reviewed the original hash mismatch before its correction: the abbreviated
  stub versus the full policy is a fixture metadata error. The saved reproducer
  retains both original hash anchors and verifies unchanged native outputs and
  RNG trace. The corrected hash is derived, never substituted as a magic value.
- Reviewed all saved hash, concurrency, prepared-result and feature-reload
  assertions. Fresh ports consume JSON-restored rows. Policy A/profile A/50x
  survive all 30 free resolutions and the 15 -> 30 -> 30 replay; the next new
  paid round uses policy B/profile B/20x. The class selector itself is counted.
- Flash focused run: 25 passed across the two payout-distribution test files.
  Astra independently ran only the saved feature/reload case:
  `node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand test/payout-distribution-runtime.spec.ts -t 'keeps the originating policy'`
  Result: 1 passed, 5 skipped, exit 0.
- Astra independently probed changed-payload conflict AFTER JSON reload, followed
  by identical replay: the conflict is explicit, the original response survives,
  and class-selector calls, RNG factories and debit calls each remain exactly 1.
- Product hashes were independently checked against the pre-phase baseline:
  LuckyLadyAdapter C254BE3D3320366A0446ECB9497080BB9C031A70CD81E1AB35FA6707A29A8764;
  game distribution 314D4B009651EFEC0C93F4EA121ED3D9BEED73DF203B6BC11DB4E2E096BFAC5E;
  shared distribution C18B483C83486BCACC163462056E1C7C726689B06D869758BE6D809A28241267.
  No product source changed. Selector arguments still contain global policy and
  random source only; no player balance, history or profitability input exists.
- ACCEPT: both regression blockers are closed. This verifies the serialized-row
  persistence contract, not PostgreSQL durability or browser/HTTP integration.
  Only the runtime regression spec and this report changed in this phase.
  All wider work remains uncommitted; no profiles were activated.