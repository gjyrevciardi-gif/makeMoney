# Fool's Gold integration: Lucky Lady's Charm Deluxe

Status: **implementation complete after the root review corrections, ready for
re-review.** No commit, merge, push or deployment was performed. The frozen
`PLATFORM-INTEGRATION-PLAN.md` in this directory was not modified.

## Baselines

| Item | Value |
| --- | --- |
| Integration worktree | `C:/Users/Admin/Desktop/toto`, branch `integration/game-workspaces` at `74c841a` |
| Read-only game source | `C:/Users/Admin/orca/workspaces/toto/lucky-lady-runtime` at `6e11d04` |
| Recovered client | external `heidi-luong1109--game/.../LuckyLadysCharmDX`, 185 files, never copied into Git |
| Profile canonical hash | `eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f` |

The accepted evaluator, rule table and frozen profile were copied byte-for-byte
out of `6e11d04` and are hash-checked at load; nothing was recalibrated, no RTP
artefact was regenerated, and the recovered 185-file client was left untouched
(proved by a manifest comparison in the browser suite).

## What was built

One registered game (`lucky-lady`, category `SLOTS`) with its own session,
launch, settlement and receipt persistence:

| Area | Files |
| --- | --- |
| Maths adapter | `backend/src/casino/games/lucky-lady/lucky-lady.math.ts` plus the vendored `math/engine.mjs`, `math/data/rules.json`, `math/profiles/lucky-lady.rtp50.v1.json`, `math/settings.json`, `math/language.json` |
| Identity and registry/config | `lucky-lady.definition.ts`, additions to `casino-game.registry.ts` and `casino-config.defaults.ts` |
| Gameplay service | `lucky-lady.service.ts` (protocol, settlement, receipts, prepared-outcome journal) |
| HTTP surface | `lucky-lady.controller.ts`, `lucky-lady.dto.ts`, registration in `casino.module.ts` |
| Persistence | `LuckyLadyLaunch`, `LuckyLadySession`, `LuckyLadyPrepared`, additive receipt/provenance columns on `CasinoRoundAction` and `LedgerEntry`, migrations `20260929120000_lucky_lady_integration` and `20260929160000_lucky_lady_review_fixes` |
| Game origin | `games/lucky-lady/gateway/server.mjs`, `entry.html`, first-party `recovery-client.js` |
| Launcher | `frontend/app/casino/slots/lucky-lady/page.tsx` |
| Evidence tooling | `games/lucky-lady/evidence/backend-harness.cjs`, `games/lucky-lady/evidence/browser-check.cjs` |

The launcher is a platform page with a single **Launch game** action. It asks the
platform API for a one-time capability and submits it as a top-level form POST to
the game gateway in a new tab, so no secret is ever placed in a URL, referrer,
log, storage or game message.

## Randomness

Every real draw comes from the OS CSPRNG through the engine's single
`int(min,max)` interface (`crypto.randomInt`), exactly as the accepted runtime
ran it. `engine.createRng` is a 32-bit simulation PRNG, so it is **never** used
to produce a real outcome: seeding a weak generator from the OS does not make it
strong. The deterministic generator exists only as an explicit constructor-level
test seam, with a usage counter that an active-path test asserts stays untouched
under the production configuration; no HTTP field, header, environment variable
or fixture file can select it.

Because the generic commit/reveal verifier does not reproduce this game's draws,
the registry publishes `supportsFairness: false` for `lucky-lady` and the round's
recorded reference is an opaque audit identifier rather than a seed. Nothing in
the UI or the API claims provable fairness for this title.

## Trust boundary

Three capabilities, all opaque and hashed at rest:

1. **Platform access token** (existing) authorizes `POST /casino/lucky-lady/launch`.
   That route is `USER`-only and re-reads the database role, so an administrator
   holding a live token is refused (`PLAYER_ROLE_REQUIRED`), the registry switch
   and the operator's enabled/maintenance state are checked, and the caller is
   rate limited.
2. **Launch capability** — 256 bits of CSPRNG entropy, 60-second expiry, scope
   `game:lucky-lady:play`, stored only as `sha256`. Consumption is a conditional
   `updateMany`, so a replay of the exchange is refused even under a race.
3. **Game session capability** — a separately random 12-hour secret bound to one
   user and one game, stored only as `sha256`, re-checked against the database
   role and the game's availability on every call.

The gateway is a narrow loopback host that serves only the client's static files,
the capability exchange and the one game protocol route. It validates Host on
every request, applies a self-only CSP with `no-store`, bounds bodies at 8 KiB,
constrains static paths to the configured client directory with a MIME
allowlist, and needs no privileged platform credential because the opaque game
capability is what the platform validates. Gameplay reaches the platform as an
`x-lucky-session` header, never as a platform cookie, so the recovered client
shares no origin or credential with the authenticated application.

Cross-origin handling is explicit and narrow:

* **All native gameplay stays same-origin.** Any other Origin is refused.
* **Only `POST /launch` accepts a platform caller**, and only when the Origin is
  one of the configured `LUCKY_LADY_LAUNCH_ORIGINS` (default
  `http://localhost:3000`). Missing and opaque `null` origins are rejected.
  The form uses `rel="noopener"` to preserve Origin while isolating the game tab.
  A valid, unexpired, unconsumed token is additionally required.
* **Startup refuses unsafe wiring**: the game origin and the platform origin must
  use different hostnames (so no credential can be shared), and both, plus every
  configured launch origin, must be loopback unless `LUCKY_LADY_ALLOW_REMOTE=true`.
  A non-loopback platform URL is never reached by accident.

## Money model

One clean-math integer unit is one platform point, ten lines are always active,
and the native per-line ladder is **1/2/5/10/20 whole points**, so a round wagers
10/20/50/100/200 points. The native settings publish that same ladder (`Bet`), so
the total stake the client displays is exactly the point amount the ledger
debits. There is no fractional display anywhere: the recovery payload carries
the same whole units the client shows, and the API rejects any value that cannot
be represented exactly instead of rounding it.

* A paid round debits the wager once (`CASINO_BET`) and records the outcome.
* Winnings stay **pending inside the round**; nothing is credited at spin time.
  `getSettings` and the recovery snapshot always report the real
  `Wallet.balance`.
* Free spins add to the pending win with no wager debit.
* Gamble win doubles the pending win; gamble loss sets it to zero and closes the
  round. Neither moves money, so a loss cannot debit the stake twice.
* Collect (the native terminal settlement action) appends exactly one
  `CASINO_WIN` and credits the wallet in the same transaction. The ledger key
  `casino:lucky-lady:win:<roundId>` makes it exactly-once.
* The stake limits are **fixed by the game's own spec**, not a control that is
  silently ignored: a configuration candidate that moves them away from 10..200
  is refused, while enabled/maintenance remain operator-controlled.
* Every BigInt → native number conversion is guarded; a balance or payout that
  cannot be represented exactly is refused rather than rounded.

## Durability, concurrency and receipt

* **Prepared outcome.** The complete paid round (paid board **and** the whole
  future feature sequence) or one gamble draw is committed to
  `LuckyLadyPrepared` *before* any wallet movement, together with the session,
  action, and the exact round id/version/phase it was drawn against. Settlement
  consumes that stored row, and refuses to apply it to any other round state
  (a superseded outcome is discarded in its own transaction so it cannot poison
  a request identity). A crash, a serialization failure or a lost response can
  never cause a reroll or a second debit.
* **Serialization.** Every mutation takes
  `pg_advisory_xact_lock(hashtext('casino:lucky-lady'), hashtext(userId))` first,
  then re-checks the stored response, the round guard and the receipt gate. A
  prepared outcome for another request blocks the newcomer, so two distinct
  concurrent gambles produce one accepted action and one `SETTLEMENT_PENDING`
  conflict, with a single draw and a single progression.
* **Ledger provenance.** Each movement locks the wallet row (`SELECT … FOR
  UPDATE`), writes the exact `balanceBefore`/`balanceAfter`, the originating
  `gameSessionId` and the `actionId`, and mirrors a `CasinoTransaction` with the
  same idempotency key. The ledger remains the single authoritative, append-only
  record; the new columns are additive and stay null for the first-party games.
* **Response cache.** `CasinoRoundAction` (additive `seq`, `gameId`, `canonical`,
  `deliveredAt`, `ackedAt`) stores the response and its canonical request
  semantics. The stake and line count are validated *before* any replay lookup,
  so a fractional stake can never round into a cached request. Replays return the
  database's own JSON, so first delivery and every replay serialize identically;
  different semantics under the same key is a 409.
* **Presentation receipt.** `deliveredAt` records a transmission attempt;
  `ackedAt` records the client's confirmed rendering. The latest authoritative
  action is resolved by the database-generated monotonic `seq`, never by a
  random-UUID tie-break. No further gameplay action may execute until the latest
  result is acknowledged, an acknowledgement must name that exact action (a
  stale id cannot release a newer result), and reads, exact replays and duplicate
  acknowledgements stay harmless.
* **Gamble recovery shape.** A gamble response carries no board of its own, so
  the round keeps the last *spin* result for the reels and stores the gamble
  presentation separately. A refresh after a gamble win, after a losing gamble,
  and after collecting a gambled win restores the same board, the same pending
  win and the same wallet with no page errors.

## One deliberate adaptation to the accepted bridge

`games/lucky-lady/gateway/recovery-client.js` is the accepted bridge with a
single presentation line changed. It previously computed the displayed credit as
`balance - pendingWin`, which assumed the pilot's early-credit bookkeeping. Under
the platform model the displayed credit is exactly the wallet balance and the
native `AddWin` adds the pending win once collect has settled. No recovered
bundle or asset was edited, and the receipt/ACK logic is unchanged.

## Evidence

| Command | Result |
| --- | --- |
| `npm test` (whole backend suite, real PostgreSQL + Redis) | **27 suites, 547 tests, all passed** |
| `node --experimental-vm-modules ../node_modules/jest/bin/jest.js --runInBand test/lucky-lady.integration.spec.ts` | **28 passed / 28** |
| `node games/lucky-lady/evidence/browser-check.cjs` | **91 checks, 0 failures** (`evidence/browser-check.json`) |
| gateway configuration guard probe | valid loopback config starts; same-hostname game/platform origins and non-loopback origins are refused |
| `npm run build -w backend` | passes; the hash-verified maths assets are copied into `dist/src/...` |
| `npx tsc --noEmit` (backend and frontend) | clean |
| `prisma migrate diff --from-url … --to-schema-datamodel` | no drift |

`lucky-lady.integration.spec.ts` runs against **real PostgreSQL** and covers:
zero-wallet and unaffordable rounds with no draw, the audited admin grant path,
role denial, expired/reused/wrong-scope launch capabilities, session binding, a
paid debit with an exact 15/15 visible board, whole-point denominations, pending
win then one collect credit with an unchanged ledger on replay, a full 15-spin
feature with no extra debit, a live 15 → 30 retrigger without another debit,
gamble win and loss with no ledger movement and no second debit, identical/
concurrent/conflicting replays with execution and debit counts, two distinct
concurrent gambles collapsing to one accepted action, a superseded prepared
gamble being refused rather than applied, the acknowledgement gate (including a
stale receipt), refresh recovery that does not advance counters, exact ledger
provenance (session, action, before/after) with the append-only trigger still
rejecting update and delete, wallet/ledger/`CasinoTransaction` reconciliation,
rollback after an injected failure both before settlement and **after the wallet
write**, the same prepared outcome settling on retry with one draw, the pinned
profile identity on the round and in the snapshot, an active-path assertion that
the production configuration never touches the simulation PRNG, and cross-user
IDOR plus round-header spoofing against a second normal user.

The browser suite drives the unmodified 185-file client through the gateway with
Chrome and asserts: administrator and anonymous launch denial, hash-only
capability storage, single-use exchange, an HttpOnly game-only cookie with no
token in the redirect URL, gameplay refusal without or with a forged capability,
the locked 10-line frozen profile, a whole-point stake ladder, **a paid round
whose displayed total stake equals the ledger debit**, 15 rendered symbols equal
to the server board, exactly one debit, a receipt posted only after the board was
rendered, one exact collect credit, refresh recovery with the same board and no
extra ledger row, the 15-spin feature with a mid-feature refresh, a live
retrigger to 30 spins, refresh after a winning gamble, after collecting it and
after a losing gamble (board stable, pending and wallet unchanged, no page
errors), the native gamble not touching the ledger, cross-user isolation,
ledger/wallet reconciliation, zero external requests, zero page errors and
byte-identical client files - and then **the real Next launcher page**: sign in,
click Launch game, land in a new tab on the clean game URL, see the platform
wallet, and play one paid round whose board matches the server. Untrusted and
foreign-origin launch and gameplay requests are refused; configured origins
require a valid token; missing and opaque `null` origins are rejected.

Screenshots are written to
`docs/agent-work/lucky-lady-runtime/evidence/screenshots/` (gitignored).

## Shared changes and why the platform's own tests moved

* `CASINO_GAME_IDS` / registry / config spec gained `lucky-lady` (required to
  register the game and reuse the audited availability and grant paths), with the
  full name `Lucky Lady's Charm Deluxe`, the Novomatic/Greentube provenance in
  the description and keywords, and `supportsFairness: false`.
* Two additive migrations: the launch/session/prepared tables plus receipt
  columns, and then the monotonic action sequence, the ledger provenance columns
  and the prepared-outcome origin. No existing column changed, and the new
  provenance/receipt columns stay null for the first-party games; the monotonic
  action sequence is assigned to every action by PostgreSQL.
* `RATE_LIMITS` gained three additive policies for the new routes.
* Four existing casino assertions were updated to the roster the branch already
  had: **`titans-tempest` was registered at `74c841a` without updating them**, so
  `lists seven playable games`, `filters by category`,
  `publishes the full rules through both config endpoints` and
  `classifies how each game may be configured` were already failing before this
  work. They now assert the current catalogue (three slot families) and the
  nine-game config list.
* `backend/package.json` runs Jest through the local binary with
  `--experimental-vm-modules`, because the accepted evaluator is an ES module and
  Jest can only `require()` ESM with its VM modules API. Production needs no
  flag: plain Node 24 `require()`s the same file directly.
* `backend/nest-cli.json` copies the maths assets into `dist/src`, so the
  production build loads the same hash-verified files.
* `.env.example` documents the gateway's origin, client directory, launch-origin
  allowlist and remote-access switch.

## Remaining limits

* The gateway and harness are loopback development surfaces. Production
  deployment, TLS, and `Secure` cookie enforcement
  (`LUCKY_LADY_COOKIE_SECURE=true`) are configuration, not validated here.
* The recovered client is served from the external directory by configuration;
  those 185 files intentionally stay outside Git.
* Only the validated 10-line configuration at the native whole-point ladder is
  accepted; other line counts and stakes are rejected before any draw.
* Concurrency is proved for one platform process and real PostgreSQL advisory
  locks; multi-process deployment was not exercised.
* No provable-fairness verification is offered for this title (see Randomness);
  the round's recorded reference is an audit identifier.
* The platform's generic casino read endpoints stay available to the owning
  player. For a finished Lucky Lady round they reveal the round's recorded
  private state, which by then contains only already-consumed boards; while a
  round is open the projection omits it entirely, so future feature boards stay
  server-private.

## Environment used

Docker's daemon was unavailable, so a disposable PostgreSQL 18 cluster from the
installed binaries was initialized at `C:/Users/Admin/orca/test-pg` and bound to
loopback port 55432 with databases `lucky_lady_test` and
`lucky_lady_shadow_test`; the pre-existing Redis service on `127.0.0.1:6379` was
used for the rate limiter. The browser evidence additionally runs the compiled
platform on `localhost:3101`, the gateway on `127.0.0.1:8790` and the real Next
launcher on `localhost:3000`. No ambient development database, credential or
production service was touched.

```text
# disposable database (already created for this run)
DATABASE_URL=postgresql://test_runner@127.0.0.1:55432/lucky_lady_test
REDIS_URL=redis://localhost:6379

cd backend
npx prisma migrate deploy
npm run build
npm test

cd ..
node games/lucky-lady/evidence/browser-check.cjs

# run the game for a human
node games/lucky-lady/gateway/server.mjs            # 127.0.0.1:8790
node backend/dist/src/main.js                       # platform API on :3001
npm run dev -w frontend                             # launcher on :3000
```
