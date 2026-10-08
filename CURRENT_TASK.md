# Current Task

## Priority

Book of Ra completion -> Game Pipeline v1 -> Gates/Book integration validation.

## Do not

Do not start game #3 yet.

## Progress (2026-09-23)

- Both game workspaces are now real npm workspaces: `games/gates/backend`, `games/gates/frontend`, `games/book-of-ra`. Root commands work: `npm run game:gates:test`, `npm run game:book:test`, `npm run games:test`, `npm run backend:test`, `npm run acceptance`.
- Gates: 34/34 backend tests pass unmodified (self-contained `node:sqlite` wallet, no shared DB).
- Book of Ra's engine dependency is resolved: the required `@playtech/slot-skills` runtime packages (`schema`, `math`, `features`, `runtime`, `host` — MIT licensed) are vendored as source-only internal packages under `packages/slot-skills/*`, building from source via each package's own `tsc`, not from committed `dist/`. See `packages/slot-skills/README.md` for exactly what was and wasn't brought in and why.
- All 63 existing tests across those 5 packages pass unmodified, including `book-of-ra.test.ts` (10 paylines, left-to-right evaluation, highest-per-line, Book wild, 3/4/5 Book scatter payouts). No implementation bugs found — nothing needed fixing.

## Known gaps / blockers

- **No existing automated test covers**: persistent expanding-symbol selection, non-adjacent expansion, retrigger +10, gamble (correct/wrong/collect, 5-attempt limit, autoplay exclusion), duplicate-gamble idempotency, or refresh/session recovery — even though the logic for these exists in `packages/slot-skills/host/src/host.ts` (a literal `bookOfRa`-namespaced state machine, e.g. the 5-gamble-attempt cap) and `packages/slot-skills/features/src/hooks.ts` (expanding wilds). Writing that test coverage is real, separate work, not something to fabricate under an "import/integrate" task.
- **Browser bundle and compiled game definition are still the originally-committed static output** (`games/book-of-ra/player/build/slot-client.js`, `games/book-of-ra/book-of-the-sands/build/game.bundle.json`). Regenerating them from source needs the toolkit's build/bundling packages (`cli`, `configurator`, `templates`, `tools`, `web-client`, `canvas-effects`, `spine`), which were not vendored — only the math/runtime/logic layer was, since that's what the test checklist needed. Bringing in the build pipeline is a separate, larger follow-up.
- **Gates**: `frontend/public/gates/*` Zeus/Gates-of-Olympus-styled art+audio remains excluded (licensing risk) — the frontend will 404 on those specific asset loads until replaced with original art. Not addressed here, as instructed.
- **Platform `backend:test`** (NestJS/Jest) requires `DATABASE_URL` pointing at a `_test`-suffixed database; none is configured in this environment, so it fails its own safety guard rather than running against `fools_gold`. This is reported by `npm run acceptance`, not bypassed.
