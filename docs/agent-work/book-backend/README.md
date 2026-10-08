# BOOK-BACKEND-FINAL — Book of the Sands backend

Branch `feature/book-backend-final`, captured baseline `74c841a61245d4851abf6bba5a82a4873b97e313`.
All work happened in `C:/Users/Admin/orca/workspaces/toto/book-backend`; `C:/Users/Admin/Desktop/toto`
and the sibling UI workspace were never written to.

The deliverable is the authoritative, production-shaped backend for Book of the Sands
(`book-of-the-sands` in the engine, `book-of-ra` in the platform registry): one frozen
mathematics profile, one implementation of the game, a PostgreSQL-backed platform adapter with
an atomic wallet/ledger path, and measured evidence that the served return is 49.9976%.

## 1. What shipped

### 1.1 Engine (`packages/slot-skills/*`)

- `math/src/book-of-ra.profile.ts` (new) — the global immutable profile
  `book-of-ra.v1.rtp5000`: 5x3 layout, exactly ten paylines, the canonical paytable
  (premium pays from two of a kind, honour cards from three), scatter pays 2/20/200 on the
  total stake, ten free games, +10 per retrigger, five-attempt gamble, and the fixed symbol
  weights. The profile is deep-frozen, hashes its own mathematics
  (`BOOK_OF_RA_PROFILE_FINGERPRINT`) and validates itself at import and at platform startup.
- `math/src/book-of-ra.ts` — the evaluator now reads the paytable from the frozen profile
  (falling back to the canonical table when a caller passes a partially specified game), and
  exposes `bookOfRaExpandingMinimum` / `bookOfRaExpandingWin` so the expansion rule has one
  implementation.
- `runtime/src/book-of-ra-round.ts` (new) — the authoritative round engine: grid, line wins,
  Book wild/scatter, free-game state machine, persistent expanding symbol, retriggers, and the
  gamble ladder. Every money decision the game makes lives here.
- `runtime/src/engine.ts` — `DefaultGameEngine` now delegates the Book of Ra path to that
  module and resolves pending actions through `resolveActionStep`, which returns the next
  continuation for a multi-step gamble.
- `runtime/src/simulation.ts` — the worker location is resolved lazily from
  `simulation-worker-url.ts`, so a CommonJS host (Nest, or Jest transpiling the engine) can
  import the engine without parsing `import.meta`.
- `features/src/hooks.ts` — the persisted Book of Ra feature state carries the profile id and
  fingerprint, the free-spin ledger, the pre-drawn gamble colours and the last outcome.
- `host/*` — reference harness repairs: zero-cost reservations are accepted, one round commits
  in one transaction, idempotency keys are scoped to player/game/operation and bound to a
  request fingerprint, a pending action blocks a new paid round, and the gamble is resolved by
  the engine rather than by the host.
- `*/package.json` — an explicit `require` export condition so the CommonJS platform can load
  the engine through Node's `require(esm)`.

### 1.2 Platform (`backend/`)

- `src/casino/games/book-of-ra/book-of-ra.definition.ts` — published rules, profile id and
  fingerprint, stake limits, and startup validation.
- `src/casino/games/book-of-ra/book-of-ra.service.ts` — the authenticated adapter: stake and
  limit validation, atomic debit, immutable ledger, round row, session, scoped idempotency and
  the presentation projection.
- `src/casino/games/book-of-ra/book-of-ra.controller.ts` + `book-of-ra.dto.ts` — routes and the
  request contract (unknown fields are rejected outright).
- `src/casino/casino-game.registry.ts`, `casino-config.defaults.ts`, `casino.module.ts` —
  registry entry (`book-of-ra`, SLOTS, `/casino/slots/book-of-ra`), a `CANONICAL` RTP control
  spec, and module wiring.
- `prisma/schema.prisma` + two additive migrations — `BookOfRaSession`, `CasinoRequestKey`, and
  a relaxation of the CasinoRound stake guard so a free spin can honestly record a zero stake.
- `jest.config.js` — resolves the vendored engine to its TypeScript sources for Jest.

### 1.3 Game instance (`games/book-of-ra/`)

- `book-of-the-sands/game.yaml` — calibrated weights and the 5000bps target.
- `book-of-the-sands/build/game.bundle.json`, `game.lock.json` — regenerated from that YAML with
  the vendored compiler and feature catalog.
- `scripts/calibrate-book-of-ra.mjs`, `scripts/compile-game-definition.mjs`,
  `scripts/simulate-book-of-ra.mjs`.

## 2. The profile

| | |
| --- | --- |
| Profile id | `book-of-ra.v1.rtp5000` |
| Fingerprint (sha256 of math + features) | `a2dd659daf50a38b05e7f36f7b89f2633898babe42f525f31861b2dc01f30e21` |
| Declared return | 5000 bps (50.00%), measured by simulation, not a closed form |
| Symbol weights | `high-1 7, high-2 9, high-3 11, high-4 11, low-1 31, low-2 31, low-3 35, low-4 35, low-5 40, scatter 3` |
| Paytable | high-1 `10/100/1000/5000`, high-2 `5/40/400/2000`, high-3 & high-4 `5/30/100/750`, low-1 & low-2 `5/40/150`, low-3..5 `5/25/100` (per line bet) |
| Scatter | Books pay `2/20/200` on the total stake at `3/4/5` anywhere |
| Free games | 10, locked bet per line, locked line count, `+10` per retrigger |
| Expanding symbol | one non-Book symbol, highs expand from 2 reels, honour cards from 3, non-adjacent reels allowed, paid once per spin |
| Gamble | red / black / collect, doubles on a win, zeroes on a loss, capped at 5 attempts, never offered during autoplay |

The profile contains no player, session or history input: every spin is an independent draw from
the fixed weights, and `validateBookOfRaProfile` refuses a profile that could be adaptive.

## 3. API

All routes require an access token; the acting user comes from the token, never from the payload.

| Method | Route | Body | Notes |
| --- | --- | --- | --- |
| GET | `/casino/book-of-ra/config` | – | published paytable, paylines, rules, limits, profile fingerprint |
| GET | `/casino/book-of-ra/state` | – | refresh projection: free games, locked stake, any pending gamble |
| POST | `/casino/book-of-ra/spin` | `{ betPerLine, idempotencyKey, clientSeed?, autoplay? }` | one paid spin, or the next free spin when the feature is running |
| POST | `/casino/book-of-ra/action` | `{ roundId, actionId, choiceId, idempotencyKey }` | resolves the pending gamble (`red`, `black`, `collect`) |

Spin response (abridged):

```json
{
  "gameId": "book-of-ra", "gameType": "SLOTS",
  "profileId": "book-of-ra.v1.rtp5000",
  "profileFingerprint": "a2dd659d…",
  "roundId": "…", "roundState": "FREE_GAME_ACTIVE",
  "board": [["low-5","high-2","low-1"], ["…"], ["…"], ["…"], ["…"]],
  "wins": [{ "evaluator": "book-of-ra-expanding", "symbolId": "high-2", "count": 2, "ways": 10, "cells": [{"reel":0,"row":0}], "amount": "500" }],
  "winTotal": "900", "expandingReels": [0, 3], "expandingWin": "500", "specialSymbol": "high-2",
  "betPerLine": "10", "totalBet": "100", "activeLines": 10, "stakeLocked": true,
  "freeSpinsAwarded": 10, "freeSpinsRemaining": 9, "freeSpinsPlayed": 1, "featureWin": "900",
  "pendingWin": "0", "gambleAttempts": 0, "gambleMaxAttempts": 5, "pendingAction": null,
  "settlement": { "wager": "0", "payout": "900", "settled": true },
  "balance": "…", "idempotent": false
}
```

Contract guarantees, each covered by a test:

- `pendingWin > 0` only while `pendingAction` is present; a gamble withholds its win, so the
  ledger has no credit for that round until the ladder resolves.
- `betPerLine`, `totalBet` and `activeLines` are locked for the whole feature; a free spin
  reports `settlement.wager = "0"` and ignores whatever stake the client sends.
- `roundState` is the server state machine (`IDLE`, `SPIN_PENDING`, `SPIN_RESOLVED`,
  `WIN_PRESENTATION`, `FREE_GAME_INTRO`, `FREE_GAME_ACTIVE`, `FREE_GAME_COMPLETE`,
  `GAMBLE_PENDING`, `ROUND_COMPLETE`).
- Nothing in the response exposes pre-drawn gamble colours, the raw server seed while a round is
  open, or any other hidden state.

### Idempotency

`CasinoRequestKey` is unique on `(userId, gameId, operation, requestKey)` and stores a sha256
fingerprint of the request body plus the response. A replay of the same key and body returns the
stored response with `idempotent: true`; a replay with a different body is refused with
`IDEMPOTENCY_KEY_CONFLICT`; a key used by another player is simply a different key. Concurrent
duplicates are serialised by the player's session row lock and, if they still race, the loser is
answered with the winner's committed response.

A replay returns the stored response verbatim, including the balance it recorded at the time,
because it is a replay of that round rather than a fresh read. `GET /casino/book-of-ra/state` is
the fresh read.

### Money and persistence

Every amount is an integer of virtual points (`BigInt` in the engine and Prisma, strings in the
API). One round is one transaction: stake debit, ledger entries (`CASINO_BET`, `CASINO_WIN`),
`CasinoRound`, `CasinoTransaction`, the session update and the idempotency record either all
commit or none do. `Wallet.balance` plus the append-only `LedgerEntry` table remain the single
source of truth; the reference SQLite wallet in `packages/slot-skills/host` is a developer
harness and is **not** production integration.

### Recovery

`GET /state` rebuilds the feature from stored session state: remaining free spins, played count,
feature win, locked bet and lines, the persistent expanding symbol, and the pending gamble with
its action id. Nothing is re-rolled and nothing is re-settled. A restart is covered by a test that
constructs a second service instance against the same database.

## 4. Verified mechanics

Each row is a checklist item from the task, with the test that covers it.

| Requirement | Covered by |
| --- | --- |
| 5x3 board, exactly ten lines | `backend/test/casino-book-of-ra.spec.ts`, `runtime/src/book-of-ra-round.test.ts` |
| Left-to-right consecutive wins, highest per line, Book wild | `math/src/book-of-ra.test.ts` (17 pre-existing tests, unmodified) |
| 3/4/5 Books pay 2/20/200 on the total bet | `math/src/book-of-ra.test.ts`, `book-of-ra.spec.ts` |
| 3+ Books award ten free games, bet and lines locked | `runtime` "awards ten free games…", backend "locks the stake and lines…" |
| One persistent, randomly chosen expander excluding the Book | `runtime` "never expands the Book…", "keeps the expanding symbol across a retrigger" |
| Highs expand from 2 reels, honours from 3, non-adjacent allowed | `runtime` "requires three reels…", "expands a high symbol on non-adjacent reels…" |
| Line wins evaluated before expansion; expansion paid once | `runtime` "expands a high symbol…" (reveal board untouched, one expanding win) |
| Retrigger `+10`, including several in one feature | `runtime` "counts ten spins exactly and stacks multiple retriggers" (30 spins, 2 retriggers) |
| Counters have no off-by-one | same test (remaining 0, played 30) |
| RED/BLACK/COLLECT resolved server-side, loss zeroes, cap of five | `runtime` gamble suite, backend gamble suite |
| Autoplay never offers the gamble | `runtime` "offers a gamble for a paid win but never during autoplay…", backend "never offers the gamble during autoplay" |
| New paid round blocked while a gamble is pending | `runtime` "refuses a new paid spin while a gamble is pending", backend `ACTION_PENDING` |
| Duplicate spin and duplicate gamble are idempotent | backend "replays an identical request…", "collects the pending win exactly once" |
| Altered payload on a reused key fails | backend "refuses a reused key whose payload changed" |
| Cross-player key reuse never reveals another round | backend "scopes an idempotency key to its own player" |
| Refresh recovers free games, pending gamble and unresolved rounds | backend "reconstructs an active feature…", "reports the same pending action after a restart…" |
| Symbol and bet survive a restart | same two tests |
| Crash/retry/concurrency behaviour | backend "serialises concurrent spins from one player", "settles only one round when the same request races itself" |
| Client cannot supply an outcome or an expander | backend "refuses a request that tries to supply its own outcome" |
| Unauthenticated calls are refused | backend "requires authentication on every route" |

## 5. Simulation evidence

Command (exit 0):

```
node games/book-of-ra/scripts/simulate-book-of-ra.mjs \
  --spins 1000000 --seeds 20260923,20260924 \
  --gamble-seeds 20260923 --gamble-trials 20000 \
  --out docs/agent-work/book-backend/simulation.json
```

The script drives `playBookOfRaRound` — the production round engine used by the platform adapter
— under `book-of-ra.v1.rtp5000`, with `SeededRngProvider` for determinism. It plays paid spins
until the requested count is reached and every triggered feature to completion. Gamble is not
offered during this run and is measured separately.

Aggregate over seeds `20260923` and `20260924` (machine-readable in `simulation.json`):

| Metric | Value |
| --- | --- |
| Paid spins | 2,000,000 |
| Free spins played to completion | 22,610 |
| Wager (integer units) | 200,000,000 |
| Base win | 90,751,700 |
| Feature win | 9,243,500 |
| Total win | 99,995,200 |
| **Base RTP** | **45.3758%** |
| **Feature RTP** | **4.6217%** |
| **Total RTP** | **49.9976%** |
| House edge | 50.0024% |
| Paid-spin hit rate | 27.61% |
| All-spin hit rate | 27.81% |
| Feature triggers | 2,227 (11.1 bps of paid spins, ≈ 1 in 900) |
| Average feature return | 4,150 units (41.5 total bets) |
| Average free spins per feature | 10.15 |
| Retrigger frequency | 15 bps of free spins |
| Expansion per free spin | 24.95% |
| Digest | `24445d3cccda4a2dab21a32923651b4ff16e8921a75b8133d3c4509f4d549d8e` |

Per seed: `20260923` → 49.96% total (base 45.48%, feature 4.48%); `20260924` → 50.02%
(base 45.26%, feature 4.76%). Both seeds are inside the 49–51% band individually.

Definitions used (also recorded inside `simulation.json`):

- **RTP denominator**: the total paid wager, including feature wins, so base + feature = total.
- **Paid hit rate**: paid spins whose own board returned a positive win, over paid spins.
- **All-spin hit rate**: every paid and free spin that returned a positive win, over all spins.
- **Feature trigger frequency**: features started, over paid spins.
- **Retrigger frequency**: retrigger events, over free spins played.
- **Average feature return**: feature win, over features started (absolute units and in total bets).

### Gamble, reported separately (excluded from the slot return)

20,000 seeded trials, always guessing red, each starting from a 500-unit pending win:

| Metric | Value |
| --- | --- |
| Amount at risk | 10,000,000 |
| Settled | 10,128,000 |
| Return against risk | 101.28% (a fair coin within sampling error; no house margin is claimed or added) |
| Trials ending with nothing | 96.83% (the theoretical value for a five-attempt ladder is 96.875%) |
| Trials ending at the five-attempt cap | 3.17% (theoretical 3.125%) |
| Average attempts | 1.94 |

## 6. Commands run, with results

| Command | Result |
| --- | --- |
| `npm run build:slot-skills` | exit 0 |
| `npm run test --workspace=@slot-skills/schema … --workspace=@slot-skills/host` | 81 passed, 0 failed (63 pre-existing + 18 new Book round tests) |
| `npx tsc --noEmit -p backend/tsconfig.json` | exit 0 |
| `npx jest --runInBand --config backend/jest.config.js --rootDir backend test/casino-book-of-ra.spec.ts test/casino-book-of-ra.integration.spec.ts` | 31 passed, 0 failed |
| casino suite regression run (`casino-admin-config`, `casino-crash-plinko-security`, `casino-registry-favorites`, `casino-slots-security`, `casino-slots.integration`, `casino-slots.spec`, `casino-tumble.spec`, `casino-security.integration`) | 246 tests, 6 failed — the identical six failures measured on the clean baseline (see §8) |
| `node games/book-of-ra/scripts/simulate-book-of-ra.mjs …` | exit 0, 49.9976% total RTP |

Test database: an isolated PostgreSQL 18 cluster initialised in this environment
(`C:/Users/Admin/orca/pgtmp-book`, port 54329, database `book_backend_test`) with all migrations
applied by `prisma migrate deploy`. The `_test` guard was never bypassed and no production
database was touched. Redis for the platform suites came from the already-running local instance
(`REDIS_URL=redis://localhost:6379`); the repository default port is not in use here.

## 7. Changed-path inventory

```
backend/jest.config.js
backend/package.json
backend/prisma/schema.prisma
backend/prisma/migrations/20260923120000_book_of_ra_backend/migration.sql
backend/prisma/migrations/20260923120500_casino_round_allows_free_spin/migration.sql
backend/src/casino/casino.module.ts
backend/src/casino/casino-config.defaults.ts
backend/src/casino/casino-game.registry.ts
backend/src/casino/games/book-of-ra/book-of-ra.definition.ts
backend/src/casino/games/book-of-ra/book-of-ra.dto.ts
backend/src/casino/games/book-of-ra/book-of-ra.service.ts
backend/src/casino/games/book-of-ra/book-of-ra.controller.ts
backend/test/casino-book-of-ra.spec.ts
backend/test/casino-book-of-ra.integration.spec.ts
package-lock.json
docs/agent-work/book-backend/README.md
docs/agent-work/book-backend/simulation.json
games/book-of-ra/book-of-the-sands/game.yaml
games/book-of-ra/book-of-the-sands/build/game.bundle.json
games/book-of-ra/book-of-the-sands/build/game.lock.json
games/book-of-ra/scripts/calibrate-book-of-ra.mjs
games/book-of-ra/scripts/compile-game-definition.mjs
games/book-of-ra/scripts/simulate-book-of-ra.mjs
packages/slot-skills/features/package.json
packages/slot-skills/features/src/hooks.ts
packages/slot-skills/host/package.json
packages/slot-skills/host/src/host.ts
packages/slot-skills/host/src/providers.ts
packages/slot-skills/host/src/sqlite.ts
packages/slot-skills/host/vitest.config.ts
packages/slot-skills/host/vitest.node-sqlite-shim.mjs
packages/slot-skills/math/package.json
packages/slot-skills/math/src/book-of-ra.profile.ts
packages/slot-skills/math/src/book-of-ra.ts
packages/slot-skills/math/src/index.ts
packages/slot-skills/runtime/package.json
packages/slot-skills/runtime/src/book-of-ra-round.ts
packages/slot-skills/runtime/src/book-of-ra-round.test.ts
packages/slot-skills/runtime/src/engine.ts
packages/slot-skills/runtime/src/index.ts
packages/slot-skills/runtime/src/simulation.ts
packages/slot-skills/runtime/src/simulation-worker-url.ts
packages/slot-skills/runtime/src/types.ts
packages/slot-skills/schema/package.json
```

No commit, stage, push or deploy was performed. `games/book-of-ra/player/**`, `frontend/**`,
`games/book-of-ra/package.json`, the Gates game, `AGENTS.md` and every auth/config/notification
path are untouched.

## 8. Limitations and honest notes

1. **Nothing was applied to a production database.** The migrations are additive, were tested by
   `prisma migrate deploy` against a throwaway `*_test` cluster, and still need a normal release
   process before they reach production. The second migration relaxes the round stake guard from
   `> 0` to `>= 0` so a free spin can record a zero stake; every game service still rejects a
   non-positive stake before opening a round, and no other game's rules or payouts change.
2. **Six platform tests were already failing on the captured baseline** and still fail, with the
   same identities: `casino-admin-config` (expects seven games and a seven-game RTP-control map),
   `casino-crash-plinko-security` and `casino-slots-security` (expect one `SLOTS` game and seven
   playable games), and `casino-registry-favorites` (expects `fools-gold-rush` to be the only slot
   in the `SLOTS` category). They went stale when `titans-tempest` was added, and adding
   `book-of-ra` widens the same mismatches. They assert product-catalogue shape rather than Book
   behaviour, so they were left untouched; updating those expectations belongs to whoever owns
   the shared registry surface.
3. **The reference host is a harness, not the production path.** `packages/slot-skills/host` still
   exposes a developer HTTP surface that takes a player id from the body; it is not mounted in the
   platform. The authenticated, owned, PostgreSQL-backed boundary is
   `/casino/book-of-ra/*`.
4. **The reference SQLite store is not the wallet.** Its atomic commit, scoped idempotency and
   zero-cost reservation are models of the guarantees; the platform keeps its own wallet and
   append-only ledger, and only that ledger is authoritative.
5. **Outcome source and fairness.** Book of the Sands draws from Node's CSPRNG, per the agreed
   architecture. Each round still records a seed commitment for the platform's existing
   verification surface, and the recorded board, profile fingerprint and RNG draw references are
   stored so a settled round can be audited; the board is *not* derived from that seed, and
   `publicState.outcomeSource` says `node:crypto-csprng` so nobody reads the commitment as proof
   of the board. A seed-derived scheme would need a separate decision.
6. **A shared platform race was worked around locally.** `CasinoConfigService.platform()` upserts
   a singleton row, and two concurrent first requests can lose that uniqueness race
   (`P2002` on `PlatformSettings`). The Book adapter re-runs the request once when a uniqueness
   error is neither its own request key nor its round, which is safe because the failed
   transaction rolled back whole. The shared fix — catch `P2002` and re-read the row in
   `platform()` — is a one-line follow-up for whoever owns the shared config service.
7. **The published return is measured, not derived.** The free games have no closed form under
   this paytable, so 5000bps is a calibration target confirmed by 2,000,000 paid spins
   (49.9976%) rather than an exact enumeration. Symbol weights were chosen with
   `scripts/calibrate-book-of-ra.mjs` and then frozen; `game.yaml`, the compiled bundle and the
   engine profile all carry the same weights, and a test fails if they drift.
8. **No UI, visual, art or asset work was done**, as instructed. The player build and the visual
   baselines are untouched.
9. **The imported POC iteration scripts are still POC-shaped.**
   `games/book-of-ra/scripts/iteration/*.mjs` (backend/visual acceptance) resolve
   `games/book-of-ra/slot-skills`, which does not exist in this repository. The working entry
   points here are the root `npm run game:book:test`, `npm run build:slot-skills`, the new
   `scripts/simulate-book-of-ra.mjs` and the Book Jest suites. Rewiring those iteration scripts
   belongs with the visual/UI workstream that also owns `games/book-of-ra/package.json`.

## 9. Reproducing this locally

No dependency was installed. The worktree borrows the already-present packages from
`C:/Users/Admin/Desktop/toto/node_modules` through junctions, with `@slot-skills/*` pointing at
this worktree's sources, so nothing in the original workspace is read at build time or written to.

```powershell
# engine build + the 63 baseline tests plus the new round engine tests
npm run build:slot-skills
npm run test --workspace=@slot-skills/schema --workspace=@slot-skills/math `
  --workspace=@slot-skills/features --workspace=@slot-skills/runtime --workspace=@slot-skills/host

# platform typecheck
npx tsc --noEmit -p backend/tsconfig.json

# isolated PostgreSQL test cluster (created for this task, port 54329)
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D 'C:\Users\Admin\orca\pgtmp-book\data' `
  -l 'C:\Users\Admin\orca\pgtmp-book\postgres.log' `
  -o '-p 54329 -c listen_addresses=127.0.0.1' start
$env:DATABASE_URL = 'postgresql://postgres@127.0.0.1:54329/book_backend_test?schema=public'
$env:REDIS_URL = 'redis://localhost:6379'
node node_modules/prisma/build/index.js migrate deploy --schema backend/prisma/schema.prisma

# Book tests: 31
npx jest --runInBand --config backend/jest.config.js --rootDir backend `
  test/casino-book-of-ra.spec.ts test/casino-book-of-ra.integration.spec.ts

# full platform suite (543 tests; the six pre-existing failures described in §8)
npm run test --workspace=backend

# return validation, writes docs/agent-work/book-backend/simulation.json
node games/book-of-ra/scripts/simulate-book-of-ra.mjs --spins 1000000 `
  --seeds 20260923,20260924 --gamble-seeds 20260923 --gamble-trials 20000 `
  --out docs/agent-work/book-backend/simulation.json

# stop the throwaway cluster when finished
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D 'C:\Users\Admin\orca\pgtmp-book\data' stop
```
