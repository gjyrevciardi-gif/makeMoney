# Game adapter and math control: final acceptance

**Astra verdict: ACCEPT for the backend/domain foundation.** Base: `e62e74746af110f9cedf29a3e08859d5be453a5a`, branch `integration/game-adapter-template`. No merge or production policy activation. The pre-existing admin UI draft remains uncommitted; UI implementation/acceptance is a later task.

## Evidence and correction

- Backend and frontend `npm run typecheck`: PASS, zero diagnostics. Backend `npm run build`: PASS.
- Complete backend run, once: **36 suites / 671 tests; 35 suites and 669 tests passed, two fixture assertions failed**. Both incorrectly included the initial `ADMIN_GRANT` in casino settlement counts/deltas.
- One bounded correction separated fixture funding from game movements, retained a full ledger/balance equality assertion, and moved Lucky Lady error serialization out of the shared gateway into its controller. Added a protocol isolation/error compatibility regression. No game math, probability, wallet implementation or ledger rule changed.
- Focused post-correction run: **9 suites / 147 tests, zero failures**. This includes the failed fixture suite, Lucky Lady integration, math statistics, MaxWin, resolved-spin source, distribution, persistent/replay distribution, policy-bankroll and generator suites.
- Consolidated coverage: **36 suites / 672 distinct tests green**, combining unchanged suites from the single full run with their focused replacements. This is not a second full-suite run.
- Accepted original-client browser harness, once: **92 checks / zero failures**. [Browser results](../lucky-lady-runtime/evidence/browser-check.json).
- Machine-readable counts, suite provenance and client proof: [acceptance.json](acceptance.json). Initial exact file classification: [inventory.json](inventory.json).

Commands from `backend`, with loopback disposable `_test` PostgreSQL and Redis configured:

```text
npm run typecheck
npm run build
npm test -- --json --outputFile=<temporary>/full-backend.json
node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand --runTestsByPath test/game-adapter-template.integration.spec.ts test/lucky-lady.integration.spec.ts test/game-math-control.spec.ts test/lucky-lady.max-win-scope.spec.ts test/lucky-lady.session-source.spec.ts test/payout-distribution.spec.ts test/payout-distribution-runtime.spec.ts test/payout-policy-bankroll.spec.ts test/payout-policy-generator.spec.ts
```

Browser command from repository root: `node games/lucky-lady/evidence/browser-check.cjs`. Both database schemas were migrated only in a newly created disposable loopback PostgreSQL cluster. No development/production database was used. Activation tests use disposable fixtures; the browser/default-runtime database had zero active generated profiles. Focused evidence output was redirected to temporary directories. The complete integration suite refreshed some historical validation/report artifacts through its existing writer; these are test evidence, not activation or recalibration of the eight generator candidates.

## Shared components and adapter contract

The shared core provides capability issuance/exchange, session binding, ownership, wallet movements, the durable action/prepared-outcome journal, receipt lifecycle, round storage, and the generic gateway. `GameAdapter` owns request validation, canonicalization, reads, execution and prepared-state reconciliation. Generic persistence holds opaque game-specific state; it does not interpret reels, symbols, bonuses or native response documents. Protocol error mapping belongs to each game controller.

Lucky Lady is adapter #1. Its controller and adapter own native protocol mapping, feature state, ACK/recovery translation, gamble and collect semantics. The original native evaluator, reels, rules and golden profile remain unchanged. The reusable math contract separates exact global policy weights/hash/selection from the game's reachable boards, payouts and conditional feature EV.

**Second-game readiness: YES.** The tiny test fixture exercises its own identity, protocol, recovery payload and round semantics against the same launch, session, wallet, ledger, prepared-result and ownership services. Another game with different protocol, reels, paytable, features and recovery payload can implement its own adapter without changing shared core. No second product game is registered.

## Launch, wallet, ledger and ownership

Launch requires authenticated USER plus availability/playability checks. High-entropy one-time capability and game-session secrets are stored as hashes. The platform re-derives player/game ownership from the session; browser ownership fields are rejected. No platform access JWT enters the recovered client.

All Lucky Lady economic movements use the existing Fool's Gold Wallet, LedgerEntry and CasinoTransaction tables through shared wallet operations. Atomic debit/credit/refund transactions retain immutable ledger provenance. No pilot wallet or parallel ledger exists. Prepared authoritative outcomes survive interruption; settlement/replay reuses them without a second RNG call. Recovery and receipts do not move points. Sufficient balance gates acceptance before generation, never changes a generated result.

Canonical identical replay returns the stored response; changed semantics conflict. Transaction-scoped advisory locks serialize same-player/game actions. Tests prove one execution/debit/outcome for concurrency, one collect credit, no free-spin wager and unchanged feature progression. IDOR checks reject foreign sessions/rounds/actions. Whole-ledger totals reconcile with wallet balances.

## Recovery and profile locking

Prepared outcomes, native boards, feature/retrigger state, pending gamble, ACK and settlement state remain authoritative and persisted. Originating rounds retain profile ID/hash and, for opt-in policies, policy ID/hash, selected class and RESOLVED_SPIN cap. Reload/replay uses stored decisions; free spins and retriggers never select a new global policy. Later policy changes affect new paid rounds only. Legacy/default rounds retain their original uncapped metadata semantics.

RESOLVED_SPIN caps each paid/free mathematical spin using the originating wager. Feature totals may exceed that cap; gamble is outside it. Reachable support is proved before generation; no payout truncation or post-result bank filtering occurs.

## Runtime regression and immutable assets

Browser evidence covers auth, launcher, Fool's Gold balance in settings, normal spin, **15/15 stable visible symbols matching the server**, win/collect, single debit/credit, duplicate requests, free spins without extra wagers, **15 -> 30 -> 30** retrigger replay, gamble win/loss, refresh recovery, IDOR, and zero unexpected external requests/page errors. Backend tests additionally cover concurrent one-execution semantics and prepared-outcome failure recovery.

All **185 original client files** match the pinned upstream Git blobs. Accepted manifest SHA-256 (sorted `path:sha256` lines): `85c26131aac4a0444ff33d420ea2060c5d4753a0e4d92e4d6937a6c78ea48a50`.

Golden `lucky-lady.rtp50.v1` hash remains `eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f`. Engine, rules and profile files match `e62e747` byte-for-byte. Active outcome paths use OS CSPRNG; no active Math.random/rand/mt_rand/shuffle or bank/player/history targeting was found. The legacy mt_rand text is a comment describing source reel indexing, not executable code.

## Generator and report review

The focused generator suite reproduces the saved eight candidate weights/hashes, exact hard constraints, true infeasibility versus bounded search exhaustion, and explicit 20x/50x support. No large simulation or recalibration was repeated. [Generator closure](../game-math-control/generated/lucky-lady/CLOSURE.md) records analytical/measured values and the RTP70 volatile confidence interval: its deviation is statistically compatible (z=-1.21), not retuned.

Exact BigInt accounting, paid/free resolved counts, conditional checkpoint populations, survival/ruin, payout bins, dry spells and house-result accounting remain green. Generated policies are review artifacts; none was activated into the accepted runtime.

## Commit inventory and limitations

Include backend source/schema/migrations, bounded test fixtures/runners, reports and compact JSON evidence. Initial inventory: 44 product files (including three excluded UI files and the renamed/deleted source path), 13 test/evidence files, 57 reports, 56 generated artifacts, nine temporary hash snapshots. No file exceeded 1 MB; credential-pattern scan found no private keys/provider tokens. Final acceptance documents and refreshed browser evidence are additional outputs.

Exclude and preserve `frontend/app/admin/page.tsx`, `frontend/app/admin/casino/math/page.tsx`, `frontend/lib/math-control.ts`, and root `pre-*-hashes.txt` / `post-*-hashes.txt`. No router/auth configuration, local database/cache, screenshots, third-party client assets or temporary full test logs belong in the commit.

Acceptance covers this backend/domain foundation, not production rollout or the existing UI draft. Generator supports the declared bounded Lucky Lady 20x/50x models; unsupported models fail closed. Search exhaustion is not a proof of infeasibility. Historical whole-round profile artifacts retain their original scope and status; they are not silently upgraded to RESOLVED_SPIN. Existing activation gates remain intact. A future Admin UI must distinguish the newer offline payout-policy generator from the earlier persisted math-profile lifecycle rather than assume they are interchangeable. No activation wiring or new UI is added by this review.
