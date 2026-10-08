# Book of Ra Classic gateway report

STATUS: ready_for_review

Task: bounded mechanical client-gateway adaptation for `book-of-ra-classic`.
Workspace: `C:\Users\Admin\orca\workspaces\toto\book-of-ra-current`, base HEAD `d6cb445`.
Owner of the backend and of integration/browser acceptance: Astra, not this task.

## What was added

All new files live under the assigned path
`games/book-of-ra-classic/gateway/` except this report:

| Path | Role |
| --- | --- |
| `games/book-of-ra-classic/gateway/server.mjs` | loopback gateway: static client origin, capability exchange, one protocol route |
| `games/book-of-ra-classic/gateway/entry.html` | launcher page that boots the exact recovered client |
| `games/book-of-ra-classic/gateway/recovery-client.js` | first-party presentation/receipt bridge |
| `games/book-of-ra-classic/gateway/preview-font-ready.js` | local font-readiness shim replacing the external WebFont loader |
| `games/book-of-ra-classic/gateway/gateway-loopback-check.cjs` | 44-check loopback suite against a stub platform (no backend needed) |
| `games/book-of-ra-classic/gateway/gateway-browser-smoke.cjs` | 19-check headless-Chrome smoke run of the gateway-served client |
| `games/book-of-ra-classic/gateway/loopback-check.json`, `browser-smoke.json`, `browser-smoke.png` | generated evidence; safe to delete or gitignore |

Nothing outside those paths was written. No backend was started, no database,
credential or production service was touched, and no commit, push, merge,
reset or clean was performed.

## Contract implemented

| Item | Value |
| --- | --- |
| Game identity | `book-of-ra-classic` |
| Backend base | `PLATFORM_URL`, default `http://localhost:3001` (loopback, never started here) |
| Launch exchange | `POST {PLATFORM_URL}/casino/book-of-ra-classic/launch/exchange` |
| Gameplay route | `POST {PLATFORM_URL}/casino/book-of-ra-classic/session/gameplay` |
| Game origin | `BOOK_CLASSIC_ORIGIN`, default `http://127.0.0.1:8791` |
| Game URL | `/games/BookOfRaCL/` static prefix, entry on `/play` |
| Native protocol route | `/game/BookOfRaCL/server` (the client's own path, unchanged) |
| Session header | `x-book-classic-session` (carries the HttpOnly game cookie) |
| Request identity | `x-pilot-request-id`, `x-pilot-version`, `x-pilot-round` forwarded as-is |
| Game cookie | `boc_session` — HttpOnly, SameSite=Strict, `Path=/`, game-only |

Environment: `BOOK_CLASSIC_GATEWAY_PORT` (8791), `BOOK_CLASSIC_GATEWAY_HOST`
(`127.0.0.1`), `BOOK_CLASSIC_ORIGIN`, `BOOK_CLASSIC_CLIENT_DIR`,
`BOOK_CLASSIC_LAUNCH_ORIGINS` (`http://localhost:3000`),
`BOOK_CLASSIC_COOKIE_SECURE`, `BOOK_CLASSIC_ALLOW_REMOTE`, `PLATFORM_URL`.
`.env.example` documentation for these is outside this task's ownership.

The security posture is carried over unchanged: Host allowlist on every
request, same-origin-only native traffic, cross-origin `POST /launch` accepted
only from a configured launcher Origin (missing and opaque `null` origins are
refused), a self-only CSP plus `nosniff`/`no-referrer`/`no-store`, an 8 KiB body
cap, path containment and a MIME allowlist for static files, and a startup guard
that refuses a game origin sharing a hostname with the platform or leaving
loopback. The gateway holds no privileged credential.

## Entry page

`entry.html` reproduces the cached reference template
`resources/views/frontend/games/list/BookOfRaCL.blade.php`
(`C:\Users\Admin\orca\research\game-pack-forensics\external\frontend-hunt\files\heidi-luong1109--game\resources\views\frontend\games\list\BookOfRaCL.blade.php`)
script-for-script and in the same order, with `GameGamble.js` and
`GameBonus.js` both enabled because this client ships both features. Two
deliberate substitutions match the accepted Lucky Lady gateway:

* the blade's external `/game/BookOfRaCL/js/lib/webfont.js` loader is replaced by
  the same `WebFontConfig` object plus the local
  `/preview-font-ready.js` shim, so the six `@font-face` families resolve from
  `/games/BookOfRaCL/css/fonts.css` with zero outbound requests;
* `/recovery-client.js` is the single added script.

The recovered bundles and assets are served byte-for-byte as recovered and are
never edited by the gateway.

## Classic-specific adaptations to the bridge

The bridge is the accepted Lucky Lady `recovery-client.js` with its contract
intact (`recoveryCollect`, `recoveryGamble`, `ack`, receipt gated on rendered
board, identical retry/identity headers). Three changes are required by the
Classic client, all documented in-code:

1. the protocol path is `/game/BookOfRaCL/server`;
2. Book of Ra Classic has no `slotFreeMpl` setting, so `state.free.multiplier`
   is written only if the client settings actually publish that key — the
   expanding-symbol feature is carried entirely by the result's
   `expSymbol`/`expReels`/`expLines`/`expPay` fields, which the native
   `FillServerReel` reads from the restored `slotSpinResult`;
3. the restored line index is matched numerically
   (`gameLine.findIndex(v => Number(v) === Number(slotLines))`) because this
   client's own `ReBet()` treats `gameLine` entries as possibly string-valued;
   every nested snapshot read (`settlement`, `free`, `gamble`) defaults instead
   of throwing, so a partial snapshot cannot wedge the page.

Everything else the restoration touches exists in this client with the same
shape as in Lucky Lady: `GameReel._view`/`FillServerReel`, `CreateGame`,
`ServerConnect`, `ButtonsController`, `ResponseController`, `slotStateData.scatShow`,
`slotStateData.gambleEnd`, `slotSettings.Bet|gameLine|Balance`, `gameBonus.HideBonus`,
`gameBonus.ShowBonus`, `gameView.EndBonus`, `gameView.ShowBonus`,
`gameCounters.ShowWinPaid`, `gameGamble.ShowPrevCards`, `gameGamble.UpdatePrevCards`.

## Verification

| Command | Exit | Result |
| --- | --- | --- |
| `node --check` on `server.mjs`, `recovery-client.js`, `preview-font-ready.js`, `gateway-loopback-check.cjs`, `gateway-browser-smoke.cjs` | 0 | all parse clean |
| `node games/book-of-ra-classic/gateway/gateway-loopback-check.cjs` | 0 | **44 checks, 0 failures** (`loopback-check.json`) |
| `node games/book-of-ra-classic/gateway/gateway-browser-smoke.cjs` | 0 | **19 checks, 0 failures** (`browser-smoke.json`, `browser-smoke.png`) |
| client manifest vs `reference/client-manifest.json` | 0 | **282 files, 0 missing, 0 extra, 0 mismatched** |

What the loopback suite proves about this gateway, with a stub platform and no
backend: the client directory matches the reference manifest before and after
serving; `/healthz`, `/play`, the shim and the bridge are served with the right
types; the entry document carries the restrictive CSP and no absolute external
reference; `/games/BookOfRaCL/js/core.js` is returned byte-identical to the file
on disk; JSON, images and audio resolve while missing files, an encoded
`../../` traversal and anything outside `/games/BookOfRaCL/` do not; a foreign
`Host` and a foreign gameplay `Origin` are refused without reaching the
platform; gameplay without a cookie is refused locally; the launch form is
refused from an untrusted or missing Origin and with an undersized token;
the exchange returns `303 /play` with an `HttpOnly; SameSite=Strict` cookie and
no token in the URL; gameplay forwards the body verbatim to
`/casino/book-of-ra-classic/session/gameplay` with `x-book-classic-session`,
preserves the query string and the round guards, replaces a malformed request
id with 24 fresh hex bytes, never forwards the platform cookie, and drops a body
over the 8 KiB bound without forwarding it upstream (the observed client effect
is a closed connection, exactly as in the accepted Lucky Lady gateway); and both
configuration guards still refuse a same-hostname game/platform pair and a
non-loopback game origin.

What the browser smoke run proves against the real recovered client in headless
Chrome: the exchange cookie admits the page, the entry document loads, every
native script comes from the gateway origin, the local font shim fires
`InitializeGame()`, the bridge installs its hooks, the client's own
`{"slotEvent":"getSettings"}` reaches the platform route carrying the session
header, every native asset resolves 200 including `css/fonts.css`, the external
webfont loader is never requested, there are zero external requests and zero
page errors. `browser-smoke.png` shows the recovered preloader rendering (ring
of native progress sprites, `0%` in the local Arial Bold), which is the point
this run deliberately stops at.

The stub deliberately answers that read with the native `error` envelope, so
this run also observed an inherited Lucky Lady behaviour worth Astra's
attention: the bridge intercepts the request, so a rejected read never reaches
the client's own `alert` handler, and `handleFailure` reconciles it by
`location.reload()` — which has no once-per-action guard. See the risk list.

## Unchanged

* `games/book-of-ra-classic/client/**` — 282 files, byte-identical to the
  reference pack manifest (measured, and re-measured after the runs).
* `games/lucky-lady/gateway/**` — untouched; all four files still match their
  committed hashes (`server.mjs` `56fbfc35…`, `entry.html` `3dc4f143…`,
  `recovery-client.js` `41c6a487…`, `preview-font-ready.js` `c1848209…`).
* `backend/**` and `docs/agent-work/book-of-ra-current/**` other than this file —
  not written by this task. `git status` shows concurrently modified
  `casino-config.defaults.ts`, `casino-game.registry.ts`, `casino.module.ts` from
  Astra's own work; they were left exactly as found.

## Outstanding risks and decisions for Astra

1. **Rejected-read reload loop (inherited).** `handleFailure()` calls
   `location.reload()` with no per-action guard, so if the backend answers a
   read (`getSettings`/`update`) or returns a 4xx for gameplay persistently, the
   page reloads indefinitely. This is Lucky Lady parity, kept on purpose. If the
   Classic backend can return a native `error` envelope for a valid session,
   Astra should decide whether to add a bounded guard — that is a bridge
   behaviour change, not a mechanical port.
2. **Settings types.** The bridge restores `slotSettings.BetCnt`/`LineCnt` by
   numeric match, but the client renders `slotStateData.lines` directly, so the
   backend's `gameLine` and `Bet` must be the same numeric values the native
   ladder uses (Classic is a 1..9 line game, so the accepted stake/line contract
   is Astra's call, not this task's).
3. **`free.multiplier` is ignored for this client** (no `slotFreeMpl` setting).
   If Classic ever gains a feature multiplier it must be modelled in the client
   first.
4. **Cookie name** `boc_session` was chosen here; nothing in the contract names
   it. Renaming it is a one-constant change in `server.mjs`.
5. **Launcher wiring.** The platform launcher must POST the one-time token to
   `BOOK_CLASSIC_ORIGIN/launch` with its own Origin preserved (Lucky Lady uses a
   `rel="noopener"` top-level form POST) and open the game on `/play`. That
   page, the backend routes and `.env.example` are Astra's files.
6. **Not exercised here:** the real backend, database, launcher page, gamble,
   free spins, receipt/ack round-trip against a live platform, and mobile
   viewports. This task's runs cover the gateway boundary only.

## Exact startup and follow-up

Loopback gateway alone (no backend required, prints its configuration and holds
no credential):

```text
cd C:\Users\Admin\orca\workspaces\toto\book-of-ra-current
node games/book-of-ra-classic/gateway/gateway-loopback-check.cjs      # 44 checks
node games/book-of-ra-classic/gateway/gateway-browser-smoke.cjs       # 19 checks
```

Full local run once Astra's backend and launcher exist — the game origin stays
`127.0.0.1` while the platform stays on `localhost` so the startup guard's
"different hostnames" requirement is satisfied:

```text
$env:PLATFORM_URL='http://localhost:3001'
$env:BOOK_CLASSIC_CLIENT_DIR='C:\Users\Admin\orca\workspaces\toto\book-of-ra-current\games\book-of-ra-classic\client'
$env:BOOK_CLASSIC_LAUNCH_ORIGINS='http://localhost:3000'
node games/book-of-ra-classic/gateway/server.mjs        # http://127.0.0.1:8791
```

Then Astra's browser follow-up: sign in on the platform launcher, launch the
game, and confirm native `getSettings` for `book-of-ra-classic`, a paid round
whose 15 rendered symbols equal the server board, one debit and one collect
credit, the `expSymbol`/`expReels`/`expLines`/`expPay` expanding-symbol feature
with a mid-feature refresh, the native red/black gamble, refresh recovery in
`PENDING_WIN`/`GAMBLE`/`FREE_SPINS`, cross-user isolation, and zero external
requests. Until the backend is reachable, the browser run stops at the
preloader exactly as captured in `browser-smoke.png`.

Next checkpoint: Astra's backend integration + browser acceptance; re-run these
two suites only if the gateway changes.
