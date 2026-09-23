# Fast local iteration

Read `PROJECT_SPEC.md` and `CURRENT_TASK.md` at the workspace root first. Run from `C:\Users\Admin\Desktop\book-of-ra-poc`:

```powershell
npm run visual:test
npm run backend:test
npm run acceptance
```

`acceptance` runs both suites even if one fails; exit code 1 means a failure. Latest numeric JSON/logs: `screenshots/acceptance/`. Detailed evidence is archived in `screenshots/runs/visual-TIMESTAMP/` and `backend-TIMESTAMP/`. No application source, game rules, wallets or baselines are changed by normal tests.

## Visual gate

Builds changed dependencies/player only, starts or reuses `http://127.0.0.1:4175/`, and leaves its server available for review. It refuses to kill another listener. Server log: `.cache/iteration/player-server.log`. No backend startup is needed: isolated Playwright fixtures intercept state recovery and block real gameplay requests.

Captures 7 states at native reference dimensions plus 1440x900, 430x932 and 390x844 (28 cases). Two isolated contexts run concurrently, using a virtual clock and deterministic presentation effects. Production timing/RNG is unchanged. Fonts, assets, state visibility, 5x3 geometry and overflow are checked.

Every run contains `current/`, normalized `reference/`, 50% `overlay/`, absolute RGB `diff/`, plus `regression-overlay/`, `regression-diff/` and `report.json`. The canonical inventory is `reference/manifest.json`. References use contain normalization; baselines require identical dimensions. Changed pixels count any RGB difference; mean error ranges 0..255. Portrait reference scores are labelled landscape proxies because no portrait reference exists.

The enforced snapshots in `screenshots/baseline/` record approved **current behavior**. Green means no regression, NOT user-reference parity. Reference mismatch metrics remain visible in every JSON report. Current limits are zero changed pixels and zero mean error. Do not widen tolerances to hide a difference.

After an explicitly approved visual change, review the images before recording:

```powershell
npm run visual:baseline -- --reason "Describe the approved visual change"
npm run acceptance
```

Updates require a reason and passing capture/state/layout checks; prior baselines are archived. Normal tests never update them. Changing Chromium version requires explicit baseline review.

## Backend gate

Runs every existing test under schema, math, features, runtime and host, including the dedicated Book of Ra suite and future test files in those trees. Builds dependency sources before tests so imported dist code is current. Missing Book tests, runner failures, failing assertions and unexpected skips fail the command. Vitest JSON and logs are retained in each backend run. These are local fixtures/stores, not the live POC wallet. Green does not certify missing scenarios from the 25-scenario Deluxe specification.

## Prerequisites and cache

Node >=24; dependencies from `slot-skills/package-lock.json` installed in `slot-skills/node_modules/`; Playwright Chromium; seven reference PNGs; current player assets. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` may select an installed Chromium, subject to baseline version checks. No installs, external research or paid APIs run automatically.

Source, config, dependency and compiled-output hashes are cached under `.cache/iteration/`. Tests always run; only unchanged compilation is skipped. Do not launch multiple root acceptance commands simultaneously against the same build cache. Large simulations are outside the fast loop; existing simulation reports are not recertified by acceptance.

## Historical tools (not the acceptance gate)

The commands below are retained for focused investigation and old reports. Their old default reference set is superseded by `reference/manifest.json`. `test-backend-spin.mjs` submits a real demo spin and is intentionally excluded from acceptance. `build-visual-player.mjs` regenerates historical SVGs; the new cached build does not.

### Legacy visual preview and comparison

Run from `C:\Users\Admin\Desktop\book-of-ra-poc`:

```powershell
node scripts/build-visual-player.mjs
node scripts/serve-visual-player.mjs
```

Preview: http://127.0.0.1:4175/. Static assets are served locally, while `/v1/*` requests are proxied to the existing backend at `http://127.0.0.1:4174`; the component's `HttpSlotTransport` remains server-authoritative. In another terminal:

```powershell
node scripts/visual-compare.mjs --self-test
node scripts/visual-compare.mjs
node scripts/check-visual-player.mjs
```

Uses installed Playwright/Chromium. The comparison tool also accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

Options: `--url URL`, `--reference NAME`, `--reference-dir PATH`, `--output-dir PATH`, `--fit contain|cover|stretch`, `--threshold 0..255`.

Default reference is `reference-02.png`, selected for the requested classic controls. All supplied references are landscape. Portrait comparisons are explicitly labeled landscape proxies, not mobile parity validation. Replace the proxy with a supplied portrait reference before acceptance.

Captures 1440×900, 430×932 and 390×844 with DPR 1, reduced motion, fresh contexts, network/font readiness and a stable canvas. Blocks state-changing requests. Static grid/meters are in `player/symbols.mjs`; the game contract is unchanged.

Normalization defaults to centered **contain** on black, preserving aspect ratio and the full reference. `cover` crops; `stretch` distorts. Source dimensions and transformations are recorded. Reference images never become player assets.

Each viewport produces `screenshots/current-WIDTHxHEIGHT.png`, `reference-WIDTHxHEIGHT.png`, `overlay-WIDTHxHEIGHT.png` (50/50 blend), and `diff-WIDTHxHEIGHT.png` (unamplified absolute RGB difference).

Changed-pixel percentage counts pixels with any RGB channel delta greater than threshold (default 0). Mean error is sum of absolute RGB deltas / (width × height × 3), range 0..255, independent of threshold. Alpha is flattened onto black.

`visual-report.json` records metrics, reference selection, DOM/canvas geometry, overflow, errors and ten 64px regions with the largest mean error. `visual-report.html` links current artifacts. Every run is archived under `screenshots/runs/TIMESTAMP/`.

Missing references yield null scores and exit code 2, without fabricated images. Errors or horizontal overflow yield exit code 1 when references exist. Exit code 0 means measurement completed, not that parity was achieved. Old artifacts are preserved; the current report's file inventory is authoritative.

The self-test checks known 0%/50% differences, error 127.5, thresholds, normalization, exact overlay/diff pixels and PNG decoding. The browser check covers all layouts, eleven assets, fixture controls and Paytable. See `screenshots/FRONTEND-AUDIT.md` for results, remaining differences and file inventory; see `player/assets/PROVENANCE.md` for prompts.
