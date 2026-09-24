# Provenance

## Imported toolkit sources

`client/vendor/{web-client,canvas-effects,spine}/src` were imported from
frontend-only sources from the MIT-licensed `@playtech/slot-skills` toolkit:

- `slot-skills/packages/slot-web-client/src`
- `slot-skills/packages/canvas-effects/src`
- `slot-skills/packages/slot-spine/src`

Local presentation changes are confined to `web-client/src/slot-game.ts`
and `web-client/src/book-presentation.ts` (cabinet/menu/layout and motion
measurement hooks). Other retained source files were compared byte-for-byte
with the local upstream checkout. Package manifests point at source entries.
Tests, backup `.orig` files and the unused server-side Spine generation module
are excluded. The renderer uses existing original project artwork; reference
screenshots are visual specifications only.

Upstream license: MIT, `Copyright (c) 2026 Playtech`. The license text lives at
`packages/slot-skills/LICENSE` and covers this vendored source.

## What is local to this game

`client/src/index.ts`, `client/src/reference-states.ts` and
`client/build-client.mjs` are written for this repository. They wire the web
component into the game's static player and describe reference-state labels for
the presentation harness. No outcome, eligibility, balance or payout logic is
added on the client.

## Not imported

The toolkit's CLI, configurator, templates, tools and demo packages are not
present here. Game math, the compiled game definition and the authoritative
backend state machine are unchanged by this build.
