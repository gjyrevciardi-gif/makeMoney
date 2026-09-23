# Fool's Gold Club — Project Spec

## What this is

A casino platform: NestJS backend (`backend/`), Next.js frontend (`frontend/`), a growing library of casino games registered through a central game registry.

## Architecture

- `backend/src/casino/` — game registry, config defaults, controller/service/module for casino gameplay. Each game lives under `backend/src/casino/games/<category>/<game-name>/` (e.g. `games/slots/tumble.*`).
- `frontend/components/casino/` — game UI components (e.g. `casino-game-card.tsx`).
- `tests/visual/` — visual QA assets. `references/` and `baselines/` are committed and reviewed; `output/` is gitignored, regenerated on demand.

## Shared game architecture

Standalone game workspaces are integrated into the platform in three layers:

```
Fool's Gold platform
  -> launcher / platform bridge   (backend/src/casino registry + frontend/components/casino)
  -> standalone game client        (games/<game-name>/ — frontend/player assets, own build)
  -> authoritative backend         (games/<game-name>/backend, or a shared engine dependency)
```

`games/<game-name>/` holds each imported game's own source, tests, and approved visual references as delivered by its originating workspace — see `games/<game-name>/SPEC.md` for mechanics and integration status. A game living under `games/` is not yet wired into the platform's casino registry/launcher until that bridging work is done as its own task (see `CURRENT_TASK.md`).

## Invariants (never break these during unrelated work)

- **RNG**: game outcome randomness must remain provably fair and untouched by unrelated refactors.
- **Wallet / ledger**: balance mutations are append-only and auditable; never edited in place.
- **Settlement**: casino/sportsbook settlement logic is final once a round/bet is closed.
- **Auth**: session and permission checks are not to be loosened for convenience.
- **Money**: no floating-point types for monetary values.

## Out of scope for hygiene/cleanup work

Do not add or modify game client code (e.g. Book of Ra, Gates) as part of repository hygiene. Those are integrated as separate, dedicated tasks.
