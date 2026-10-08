# Book of Ra — Game Spec

Imported from the `book-of-ra-poc` workspace (Deluxe-style build, `book-of-the-sands` game id). This preserves the established product contract; it does not claim everything below is fully verified in this repository yet.

## Core mechanics

- **Grid**: exactly 5 reels x 3 visible rows.
- **Paylines**: exactly 10 active paylines (Deluxe build — not the 9-line Classic cabinet).
- **Reel motion**: strips move DOWN only — enter at the top, exit at the bottom, continuous movement with acceleration, sequential reel 1→5 stops. No upward movement, teleporting, or fades.
- **Book symbol**: both Wild and Scatter. Substitutes to complete the highest valid regular payline result. 3/4/5 Books anywhere pay 2/20/200x total bet (independent of paylines) and trigger 10 free games. Book never substitutes for the expanding symbol.
- **Symbols**: Explorer, Pharaoh/Mummy, Statue, Scarab (high), A, K, Q, J, 10 (low), Book (wild/scatter).

## Free games and expanding symbol

- Free games are entered with `betPerLine`, `totalBet`, and `activeLines` locked for the session.
- Before spin #1 of the feature, the server randomly selects exactly **one** persistent expanding symbol (never Book) and keeps it for the entire feature, including retriggers.
- Expansion minimum: 2 reels for high symbols, 3 reels for low symbols.
- Expansion can occur on **non-adjacent reels** — every qualifying reel expands to 3 rows; payout is calculated by qualifying-reel count across all active paylines, paid exactly once per spin.
- 3+ Books during free games retrigger +10 spins without replacing the expanding symbol.

## Gamble

- An eligible completed win enters `GAMBLE_PENDING`. RED/BLACK resolved server-side; correct doubles the pending win, wrong zeroes it and ends gamble; COLLECT settles it.
- Maximum 5 attempts per original win (operator/jurisdiction-configurable cap).
- **Gamble is never available during autoplay.**

## State machine and session recovery

- Server-owned states: `IDLE`, `SPIN_PENDING`, `SPIN_RESOLVED`, `WIN_PRESENTATION`, `FREE_GAME_INTRO`, `FREE_GAME_ACTIVE`, `FREE_GAME_COMPLETE`, `GAMBLE_PENDING`, `ROUND_COMPLETE`.
- All money-affecting transitions and outcomes are server-authoritative; the client only presents server results (board, wins, `expandingReels`, `specialSymbol`, gamble outcome). No client RNG or payout decisions, no locally-derived eligibility.
- On refresh, GET current game state must reconstruct any unresolved round, active feature, remaining spin count, selected expanding symbol, locked bet, and pending gamble — without leaving stuck animation or inventing balances/wins/retriggers.
- Spin and gamble requests are idempotent (duplicate submissions must not double-resolve).

## Visual direction

- Viewports: 1440x900 (desktop), 430x932 and 390x844 (mobile). Zero horizontal overflow at any viewport; phone composition is an intentional reflow, not a shrunk desktop screenshot or forced landscape.
- Approved visual source of truth: the 7 reference captures in `screenshots/reference/` (indexed by `reference/manifest.json`), covering base, paylines, paytable, win, free-games, gamble, and autoplay states. Match geometry/proportions/cabinet styling shown there — no redesign toward a generic/modern interpretation.
- `screenshots/baseline/` holds the approved-behavior regression snapshots (7 states x viewport) used for visual regression comparison. Baselines only change after an explicit, reviewed, intentional visual change — never to silently hide a failing diff.

## Known limitation — engine dependency not yet integrated

The actual math/runtime/host implementation (payline+scatter evaluator, round state machine, free-game/expansion features, wallet/session host, and the `<slot-game>` web component) lives in the source POC's `slot-skills/` toolkit — a separate, MIT-licensed third-party package (`@playtech/slot-skills`, with its own git history and its own build). It was **not vendored into this repository** as part of this import: copying a third-party package's source tree (with nested `.git`) into this app repo would duplicate a dependency rather than import "the active implementation."

What was imported here is the **game instance** built on top of that toolkit:
- `book-of-the-sands/` — game definition (`game.yaml`, `design-brief.yaml`, locales, original SVG symbol art) and its compiled `build/game.bundle.json` / `game.lock.json` (the only currently-available compiled output, since the build toolchain itself lives in the excluded `slot-skills/`).
- `player/` — the static player shell (`index.html`, `symbols.mjs`, original generated symbol/title art) and its compiled `build/slot-client.js` (same reasoning — the source lives in `slot-skills/packages/slot-web-client`, not vendored here).
- `scripts/` — the visual/backend/acceptance QA tooling (`npm run visual:test`, `backend:test`, `acceptance`), which itself depends on `slot-skills` being installed alongside this workspace.

**This means the imported client/build artifacts will not run standalone yet** — integrating `@playtech/slot-skills` (or an internal equivalent) as a real dependency is required before this game is playable end-to-end, and is explicitly out of scope for this import-only task. Do not vendor or reimplement it without a separate, reviewed decision.
