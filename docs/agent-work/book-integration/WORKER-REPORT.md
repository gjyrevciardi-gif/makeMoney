# Book of Ra integration / playtest bundle

Worktree `C:/Users/Admin/orca/workspaces/toto/book-integration`, branch
`integration/book-playtest`, created from `74c841a`. Nothing is committed: all
integration glue is left in the working tree for root review.

## 1. Cherry-pick mapping (all clean, no conflicts)

| Accepted source | Integration commit |
| --- | --- |
| backend `831cbfc` | `dc5185f` |
| UI `e413613` | `a2a5238` |
| UI `7aeff7a` | `77a0aab` |
| UI `ca37012` | `e26e3e2` |
| UI `5594c06` | `2f2908b` |
| UI `f25a46c` | `a9c6b50` |
| UI `1ca7c54` | `5cc8abb` |
| UI `b5d73a2` | `3af1faf` |
| UI `aa6a798` | `c7bcb6f` |
| UI `746146a` | `e204d7c` |

**Conflicts: none.** No merge, no push, no other worktree touched. The
uncommitted changes in `book-backend` (`docs/agent-work/`) and `book-ui`
(`scripts/iteration/*`) were not copied.

## 2. Startup (Windows, three lines including the `cd`)

```powershell
cd C:\Users\Admin\orca\workspaces\toto\book-integration
node scripts/book-integration/setup.mjs
node scripts/book-integration/start.mjs
```

`setup.mjs` is idempotent: generated config, isolated PostgreSQL cluster +
database, dedicated Redis instance, `npm install` (only if `node_modules` is
absent), `prisma generate`, `prisma migrate deploy` on both databases, the
vendored slot packages, the compiled backend and the accepted player bundle.

`start.mjs` brings the datastores up if needed, builds the backend when
`backend/dist` is missing or older than `backend/src` (restarting the old
process so the corrected code actually serves), starts the backend and the preview as
hidden processes, and provisions the local test accounts. Stop with
`node scripts/book-integration/stop.mjs` (`--all` also stops PostgreSQL and
Redis).

## 3. Live endpoints and process ids

| Purpose | URL | Notes |
| --- | --- | --- |
| Cabinet (accepted UI) | `http://127.0.0.1:4276/` | integration preview, loopback only |
| Sign-in tooling | `http://127.0.0.1:4276/integration/login.html` | outside the cabinet |
| Accepted backend | `http://127.0.0.1:4274/casino/book-of-ra/config` | loopback only |
| Isolated PostgreSQL | `127.0.0.1:55433` | cluster in `tmp/integration/pgdata` |
| Dedicated Redis | `127.0.0.1:56381` | own instance, own keyspace |

Observed pids during this run: backend 4274 → 17152, preview 4276 → 33400,
PostgreSQL 55433 → 32892, Redis 56381 → 28824. The pre-existing accepted
preview on 4275 (pid 15520) was left untouched, as was every unrelated process.

## 4. Databases (test-only, loopback-only)

| Database | Owner | Purpose |
| --- | --- | --- |
| `book_playtest_test` | the running app | local test accounts, funded wallet, rounds |
| `book_integration_test` | Jest | backend proof runs (the suite truncates) |

Both end in `_test`, both live in the isolated cluster on port 55433; the
development database `fools_gold`/`postgres` was never contacted. `provision.mjs`
re-checks the guard (name must end in `_test`, host must be loopback, port must
not be 5432) before any account or coin write.

## 5. Sign-in and funding (no bypass, no direct balance write)

Two loopback test accounts are registered with the normal `/auth/register`
flow; the administrator is promoted with the repository's own
`scripts/bootstrap-admin.js` (`BOOTSTRAP_ADMIN_EMAIL`,
`CONFIRM_ADMIN_BOOTSTRAP=GRANT_ADMIN`, audited); the player wallet is funded
through the existing append-only `POST /admin/users/:userId/coins` grant with
the persisted idempotency key `INTEGRATION_FUND_KEY`. A repeat start reports
`grantDuplicate: true` and moves nothing.

Login: `http://127.0.0.1:4276/integration/login.html`, or the preview's
auto-login, which performs a real `POST /auth/login` with the local test account
and keeps the tokens server-side only. Retrieve the credentials from the ignored
`.env.integration` (`INTEGRATION_PLAYER_EMAIL` / `INTEGRATION_PLAYER_PASSWORD`,
`INTEGRATION_ADMIN_EMAIL` / `INTEGRATION_ADMIN_PASSWORD`). No token or password
is logged. Cabinet credit is read from `GET /wallet/me`, not from the game
response.

## 6. New files (uncommitted, for review)

- `scripts/book-integration/lib.mjs` – shared process/HTTP/env helpers
- `scripts/book-integration/nest.mjs` – backend HTTP client (auth, wallet, admin, Book)
- `scripts/book-integration/services.mjs` – isolated PostgreSQL/Redis lifecycle
- `scripts/book-integration/setup.mjs` – one-shot, idempotent setup + guards
- `scripts/book-integration/provision.mjs` – local test accounts and funding
- `scripts/book-integration/start.mjs` / `stop.mjs` – start/stop the stack
- `scripts/book-integration/adapter.mjs` – integration preview: static accepted
  UI + `/session/*` login tooling + `/v1/*` → `/casino/book-of-ra/*` transport
- `scripts/book-integration/projection.mjs` – integration-only response projection
- `scripts/book-integration/test/projection.test.mjs` – projection/adapter tests,
  including the accepted `book-gamble-presentation` consumer
- `scripts/book-integration/verify.mjs` – real-HTTP verification
- `backend/src/casino/games/book-of-ra/book-of-ra.gamble-projection.ts` – additive
  whitelist projection of the resolved gamble attempt and revealed history
- `backend/test/casino-book-of-ra-gamble-projection.spec.ts` – its safety tests
- modified: `backend/src/casino/games/book-of-ra/book-of-ra.service.ts` (adds the
  `gamble` field to the round view; no other behaviour changed)

## 7. What the transport adapter does

Served from the accepted sources, read-only: `player/index.html` (unchanged on
disk; a single bootstrap module tag is appended at serve time), `symbols.mjs`,
the approved reference captures, the game bundle and the freshly built
`player/build/slot-client.js`.

`POST /v1/spins` → `POST /casino/book-of-ra/spin` (`betUnits` is divided by the
10 locked lines; the UUID idempotency key comes from the request header;
`autoplay` passes through). `POST /v1/rounds/:id/actions` →
`POST /casino/book-of-ra/action`. `GET /v1/state/:playerId` →
`GET /casino/book-of-ra/state`; the `:playerId` path segment is ignored —
identity comes from the verified token only. `GET /v1/rounds/:id` answers 501
because the accepted backend exposes recovery through `/state`, not a per-round
read. Bonus-buy and ante-bet are refused as unsupported.

Session routes are POST-only except the two reads (`/session/me`,
`/session/config`); a mutating route additionally requires a loopback `Host`
and, when a browser supplies one, its own `Origin`. JSON bodies are capped at
8 KB, and one access-token rotation is coalesced per session so concurrent
requests cannot race the refresh cookie. `/session/config` publishes the
accepted contract (`minTotalBet`, `maxTotalBet`, `activeLines`, profile, RTP) so
the host page sets the wager from the server, never from the preview fixture.

Deferred/unsupported, reported honestly: no client RNG, no client payout, no
host-side double debit, no fake balance, no auth bypass.

## 8. Response mapping and the one additive backend field

The accepted cabinet expects a `GameRoundResult`; the accepted route answers
`BookOfRaRoundView`. The adapter renames fields that already exist
(`totalBet` → `betUnits`, `winTotal` → `totalWinUnits`, `board` → `finalGrid`,
`phase` → `featureState.bookOfRa.phase`, `specialSymbol`, free-spin counters,
`pendingAction` choices) and sets `gameId` to the engine configuration id
`book-of-the-sands`, which is what the cabinet's classic gamble gate tests.

Root approved one additive, whitelist-only backend projection, now implemented
in `projectGamble`:

- `resolved`: the outcome `resolveBookOfRaGamble` returned for *this* request —
  `attempt`, `choice`, `winningColour`, `won`, `pendingWinBefore`,
  `pendingWinAfter`, `settlement`, `complete` (null when the response resolved
  nothing).
- `history`: only the already revealed attempts from `gambleHistory`.
- `pending`, `attempts`, `maxAttempts`, `pendingWin` were already public.

`gambleColours` (the pre-drawn ladder for attempts not yet made), the engine
continuation, the RNG draws and every other private field are never read by the
projection, so a new engine field cannot leak through. The resolver, the RNG,
the mathematics and the payment paths are unchanged. Tests
(`casino-book-of-ra-gamble-projection.spec.ts`) assert the ladder never appears,
no array can be as long as the ladder, and the resolved attempt identity is
explicit for RED/BLACK wins, losses and COLLECT.

**Live presentation events.** `view.board` is the *resolved* board
(`lastOutcome.finalGrid`, already expanded), so a reveal event may not use it.
The backend therefore publishes one more whitelisted field,
`spinPresentation`, copied from `state.lastOutcome`: `board` (the reveal grid
**before** any transformation), `freeSpin`, `freeSpinIndex`, `retriggered`
(the already-resolved +10 increment), `freeSpinsRemaining`, `specialSymbol` and
`phase`. No engine, RNG or state code changed.

The live event order is now the engine's own: `grid-reveal` (raw pre-expansion
board, plus the authoritative free-spin index), regular wins, the scatter win,
`reel-transform` (when `expandingReels` is non-empty, carrying the locked
`specialSymbol`; the consumer then copies the authoritative `finalGrid`
columns), the expanding win, and finally `feature-start
{featureId:'retriggering-free-spins', addedSpins}` only when the resolved
`retriggered` increment is greater than zero. Every win event carries the
engine's own `evaluator`/`symbolId`/`cells`/`payoutUnits`, and the accepted
`bookWinForEvent` matching is asserted in tests. Nothing is inferred from book
counts, win amounts or fabricated increments. The initial Free Games trigger is
left to the authoritative `phase`/`specialSymbol`/`freeSpinsRemaining` snapshot
with no book-count rule.

Refresh is snapshot-only: `projectRefresh` returns the round with an empty
event list, so no win, intro or retrigger is replayed on load. The only other
event remains the single `choice-resolved` restatement of a resolved gamble
attempt.

The bootstrap is no longer a second racing module. The served page is
transformed in place (`serve-transform.mjs`): the cabinet element is served with
`inert`, the demo `fixture.meters` line is removed, and the demo-player recovery
call is replaced by exactly one awaited
`await (await import('/integration/bootstrap.mjs')).initialize(element);`
that runs after the accepted game/config assignment. `initialize` does not poll:
it reuses an existing session via `GET /session/me`, signs in only when there is
none, refuses to continue without the accepted wager contract, recovers state
once, sets `betUnits` to the locked `totalBet` when `stakeLocked` and to
`minTotalBet` otherwise, writes `data-lines`/`data-betline`/`data-credit` from
that real config and `/wallet/me`, and only then clears `inert`. With no session
the cabinet stays inert and no meter is fabricated. The accepted source file on
disk is unchanged.

## 9. Verification (all commands run from the integration worktree)

Focused suites (existing tests, unmodified semantics):

- `npm run build:slot-skills` — schema, math, features, runtime, host build clean.
- `npm run game:book:test` — 117 tests pass (schema 30, math 30, features 8,
  runtime 40, host 9), including `book-of-ra-round.test.ts` (expander,
  retrigger +10, counters, gamble ladder) and `book-blockers.test.ts`.
- backend Jest, `DATABASE_URL` = `book_integration_test`:
  `test/casino-book-of-ra.spec.ts`, `test/casino-book-of-ra.integration.spec.ts`,
`test/casino-book-of-ra-gamble-projection.spec.ts` — 3 suites, 42 tests pass.
- `node --test scripts/book-integration/test/projection.test.mjs` — 9 tests pass:
  the reveal event carries the raw pre-expansion board while `finalGrid` stays
  the expanded board, the free-spin index, the exact event order
  (reveal → regular wins → scatter → expansion → expanding win → retrigger),
  the copied `+10` `addedSpins`, evaluator identity through the accepted
  `bookWinForEvent`, the snapshot-only refresh, the accepted
  `book-gamble-presentation` consumer, and the served-page transform (inert
  cabinet, no `fixture.meters`, no demo-player recovery call).
- Final repair pass was bounded: the projection and backend service were
  rebuilt, the focused backend suites re-run (**3 suites / 42 tests pass**) and
  the owned processes restarted. The full `verify.mjs` loop was deliberately
  **not** re-run to avoid burning spins; the numbers below are from the previous
  full run, and the live checks re-confirmed this pass were the page transform,
  `/session/me` → 401 before sign-in, `/session/auto` → 200 with the accepted
  contract, `/session/config` → 200, `GET /v1/spins` → 405, and rebound-host and
  cross-site `POST /v1/spins` → 403.
- `node --test "games/book-of-ra/client/test/*.test.mjs"` — 44 tests pass
  (autoplay source tests, gamble presentation, free games, portrait layout).
- `npx tsc --noEmit -p backend/tsconfig.json` — clean (after the slot packages
  are built, which `setup.mjs` does first).
- `node games/book-of-ra/client/build-client.mjs --force` reproduces the accepted
  `player/build/slot-client.js` byte-for-byte
  (`7C30D249…32D2A`, 546 108 bytes), so the served cabinet is the accepted one.

Real API proof (`node scripts/book-integration/verify.mjs`) — 11/11 checks pass,
machine-readable at `docs/agent-work/book-integration/verification.json`:

- profile unchanged: `book-of-ra.v1.rtp5000`, `rtpBps 5000`, 10 paylines,
  gamble max 5 attempts;
- normal spin through the accepted UI transport: round
  `7b656e9f-f009-4cb4-b2c2-d1b16c243e0d`, 5×3 authoritative board, live
  `grid-reveal` event, no `gambleColours` anywhere in the response;
- wallet and ledger: balance 999 950 → 999 850 for a 100-point losing spin, and
  exactly one new ledger entry, `CASINO_BET -100`; live win-credit is asserted
  only when the spin actually pays, and this run's leading spin did not, so it
  is labelled unproven here rather than passed on a zero payout;
- duplicate idempotency: the same key returns the same round with
  `idempotent: true`, wallet and ledger unchanged;
- autoplay-flagged spin: `pendingAction: null`, so the gamble is never offered;
- refresh recovery: `GET /v1/state/:playerId` returns the stored round and is
  only reported as feature recovery when an open Free Games round is present
  (`featureOpen: false` in this run — labelled, not claimed);
- real gamble ladder observed: one BLACK attempt, revealed losing colour `red`,
  `complete: true`, and the response contains no pre-drawn ladder.
- test-only evidence (existing deterministic RNG seam, no production route):
  `jest --runInBand test/casino-book-of-ra.integration.spec.ts
  test/casino-book-of-ra-gamble-projection.spec.ts` — 33 tests pass, covering
  positive payout settlement, duplicate gamble idempotency,
  expander/retrigger/counters and the projection safety properties.

Earlier manual probes against the same stack produced a `GAMBLE_PENDING` round
on the first paid spin, and resolving it with COLLECT settled 50 points
(`settlement.payout = 50`), confirming the gamble path end to end.

## 10. Reference hashes (unchanged art/layout)

Aggregate sha256 over the seven approved captures, `reference/manifest.json` and
`player/assets/**`: `ef7fa34fcaefdf61d8dbe5e667f0d06f04f19eee7e3816e4d6d2a95deab1f6df`.
No art, layout, reference or client source file was modified.

## 11. Environment discipline

`.env.integration`, `tmp/integration/**` and the generated player bundle are
ignored (`tmp/`, `logs/`, `*.log`, `.env.*`, `player/build/slot-client.js`).
The toolkit at `C:/Users/Admin/Desktop/book-of-ra-poc/slot-skills` is read-only;
nothing was written into the original POC. No production credential, database
or service was used, and no seeding or direct wallet write was performed.

Safety checks now run before any SQL, migration or provisioning:
`assertLocalTestTarget` validates both PostgreSQL URLs *and* the Redis URL —
protocol, loopback host, port matching `INTEGRATION_PG_PORT` /
`INTEGRATION_REDIS_PORT`, port not 5432, database name ending `_test`, a safe
SQL identifier, a name equal to the `INTEGRATION_DB_NAME` /
`INTEGRATION_TEST_DB_NAME` this bundle provisions (so an alternate existing
database cannot be injected), and the two databases distinct. PostgreSQL is
only reused when `SHOW data_directory` reports this bundle's own cluster.
Redis is only reused, cleared, or shut down when `CONFIG GET dir` equals this
bundle's data directory, any existing `bookintegration:owner` marker names that
same directory, and no key outside `rate:*` exists — the marker is never
overwritten on a foreign rate-only instance. The backend and preview listeners
are only reused when their command lines show this worktree. `stop.mjs` has no
pid-file fallback and refuses to stop a port whose owner cannot be proven, so a
reused pid or a stranger on 4274/4276 is reported instead of killed.
`requireSameOrigin` now runs for *every* route before dispatch — loopback `Host`
plus same-origin `Origin` when supplied — so `/v1/spins` and
`/v1/rounds/:id/actions` cannot be driven through a rebound hostname or a
cross-site page. The only shared-catalog use is the standard `CREATE
DATABASE`/`pg_database` probe against the isolated cluster — the cluster, both
databases and the Redis instance are this bundle's own, and the development
`fools_gold` database and its server were never contacted.

## 12. Blocked / not verified

- **No browser was available**, so no visual or Playwright claim is made. All
  evidence is API- and source-level.
- Live spins now publish grid-reveal/expansion/win events, so reels settle. The
  scatter payout and the +10 retrigger are still presented through the
  authoritative counters and the free-games HUD rather than as dedicated
  animation events: the accepted view publishes no scatter/retrigger event or
  retrigger counter, and fabricating one was explicitly out of scope.
- The gamble *result card* renders from the approved backend projection and its
  data contract is proven against the accepted consumer, but this has not been
  confirmed in a browser.
- Not proven live in this bounded run (labelled in `verification.json`): a live
  Free Games trigger, a live +10 retrigger, a full five-attempt ladder and Free
  Games refresh recovery. Positive payout, duplicate gamble idempotency and the
  expander/retrigger/counter scenarios are proven only through the existing
  deterministic backend test seam.
- `GET /v1/rounds/:id` has no backend equivalent and returns 501.
- No bonus-buy, ante-bet or free-game-purchase route exists in the accepted
  backend, so those cabinet controls are refused by the adapter.
- Six older casino Jest failures reproduced on clean `74c841a` were not
  re-investigated; this task only ran the focused Book suites.
