# Book of Ra client bundle

Rebuilds the game's static player bundle (`player/build/slot-client.js`) from
frontend-only sources.

```powershell
node games/book-of-ra/client/build-client.mjs --force
```

The build uses the repository's installed local tooling read-only. It does not
install packages, and it never touches the authoritative backend, game math
definition or the compiled game bundle.

## What is imported

`client/src/index.ts` re-exports the imported `<slot-game>` web component so the
static player can keep loading a single ES module. The component sources under
`client/vendor/` are imported, with local changes documented in `PROVENANCE.md`,
from the MIT-licensed `@playtech/slot-skills` toolkit used by the source POC:

| Vendored path | Upstream source |
| --- | --- |
| `vendor/web-client/src` | `slot-skills/packages/slot-web-client/src` |
| `vendor/canvas-effects/src` | `slot-skills/packages/canvas-effects/src` |
| `vendor/spine/src` | `slot-skills/packages/slot-spine/src` |

Unit test files are not vendored. The schema and runtime imports resolve to the
repository's own vendored `packages/slot-skills` sources, and the schema alias
points at the type-only module so no server-side compiler is bundled.

License: MIT, `Copyright (c) 2026 Playtech`. The full text is kept at
`packages/slot-skills/LICENSE`; provenance notes are in `PROVENANCE.md`.

Build prerequisites: Node 24+, Vite 7.3.6 and intl-messageformat 10.7.18 in
a local toolchain. Set `SLOT_SKILLS_TOOLKIT` to that checkout, or provide the
ignored `games/book-of-ra/slot-skills` junction. Capture tooling uses Playwright
1.61.1 from that checkout. No install is performed by the build.

`player/build/slot-client.js` and its source map are generated and ignored.
Run the source build before starting `node scripts/serve-visual-player.mjs`
from the game directory. The preview is a presentation harness, not proof of
platform backend integration. Source and original references are the checkpoint
truth; no visual-parity claim is made.
