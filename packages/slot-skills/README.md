# slot-skills (vendored runtime packages)

These packages (`schema`, `math`, `features`, `runtime`, `host`) are the server-authoritative slot engine that `games/book-of-ra` depends on. They are copied, source-only, from the `@playtech/slot-skills` toolkit (v1.3.0, MIT License — see `LICENSE`) found in the `book-of-ra-poc` workspace.

## What was intentionally left out

Only the runtime/math packages required to build and test Book of Ra's game logic were brought in. The rest of that toolkit — its CLI (`slot-cli`), the visual configurator, the asset-generation Python scripts, its own docs and AI-agent skill definitions, its demo package, and its scaffolds for other games (`alien-expanse`, `football-frenzy`) — was **not** vendored, and neither was its git history. Pulling in the whole toolkit would duplicate a separate project rather than integrate the specific dependency this game needs.

## Consequence

This means the *math/logic* layer (payline evaluation, free games, expanding symbol, gamble, session/idempotency handling) builds and tests from source here. The *browser bundle* (`games/book-of-ra/player/build/slot-client.js`) and the *compiled game definition* (`games/book-of-ra/book-of-the-sands/build/game.bundle.json`) are still the ones originally committed from the source POC — regenerating those requires the CLI/configurator/web-client/canvas-effects/spine packages, which were not brought in during this pass. See `games/book-of-ra/SPEC.md` for the current status.

## License

MIT, Copyright (c) 2026 Playtech. See `LICENSE`. Attribution preserved as required by that license; no changes were made to the vendored source itself.
