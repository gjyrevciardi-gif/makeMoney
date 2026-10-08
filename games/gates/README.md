# FOOL'S GOLD: OLYMPUS — standalone slot POC

A fully local, server-authoritative 6×5 scatter-pays tumble slot with multiplier
orbs, free spins and Buy Bonus. Virtual PTS only. No real money, no external
provider, €0 cash cost.

```
/backend    Node 24 + TypeScript   mechanics engine, CSPRNG, SQLite wallet + ledger
/frontend   Phaser 3 + Vite        renderer; animates the server response only
/shared     types.ts               the wire contract used by both sides
/tests      vitest + playwright    34 unit/API tests + browser QA
/research   Mint audit             reference only, nothing imported
/screenshots                       desktop + mobile captures
```

## Run it

```bash
# terminal 1 - backend (TEST_MODE exposes the QA vectors; omit for production behaviour)
cd backend && TEST_MODE=1 npx tsx src/server.ts     # http://localhost:8787

# terminal 2 - frontend
cd frontend && npx vite                             # http://localhost:5173
```

Open **http://localhost:5173**. The demo player starts at **100,000 PTS**.

## Tests

```bash
cd backend && npx vitest run      # 34 tests: engine, wallet, ledger, idempotency
node tests/browser-qa.mjs         # Chromium QA + screenshots (needs both servers up)
cd backend && npx tsx src/rtp.ts  # RTP simulation
```

## Architecture

The server generates **one authoritative outcome per round** and stores it. The
client receives the whole round — every board, every cascade step, every orb —
and does nothing but animate it. It cannot invent a symbol, a win or a balance.

```
POST /api/spin  { stake, roundId, buyBonus?, testVector? }
  -> { roundId, stake, kind, initialBoard, steps[], spins[], freeSpins, finalWin, balanceAfter }
```

`roundId` is the idempotency key. Replaying one returns the stored response with
`X-Idempotent-Replay: 1` and never debits twice.

### Deliberately NOT ported from the Goldsvet reference

The Gates backend was read only to understand mechanics. None of its
architecture came across:

- no bank-gated result regeneration (`WinPermission` + `goto NewSpin`)
- no `shop.percent` outcome manipulation
- no `rand()` / `mt_rand()` — production RNG is `node:crypto`
- no Laravel, no Eloquent, no `LogAndServer.php`, no `DoBonus.php`
- no auth, payment, admin, socket or vendor network code

The outcome is produced once and returned. There is no path that rejects a
result and re-rolls it.

## Maths

Tuned over a 500k-spin simulation:

| | |
|---|---|
| Total RTP | **96.39 %** |
| — base game | 42.80 % |
| — free spins | 53.59 % |
| Buy Bonus RTP | 95.92 % |
| Free-spin trigger | 1 in 179 |
| Grid | 6×5, scatter-pays, 8+ of a kind |
| Free spins | 15, +5 retrigger on 3+ scatters |
| Multiplier | orbs accumulate and **persist** across the session |
| Buy Bonus | 100× stake |

All money is integer PTS — every award is rounded at creation, so the wallet,
the ledger and the wire format are exact and cannot drift.

## Dev test vectors

With `TEST_MODE=1` the UI shows a vector panel. Each vector **seeds the same
engine production uses** — it does not bias, filter or re-roll outcomes, and it
is unreachable without the env var. Vectors: `loss`, `win`, `multiTumble`,
`multiplier`, `freeSpins`, `retrigger`, `buyBonus`.

## Artwork

Every symbol, panel, glow and the background is **generated procedurally at
runtime** (canvas + Phaser). There are no image or audio files in the project —
no Pragmatic, Gates or Zeus assets, nothing to license, nothing to host. Sound
is a few WebAudio oscillator blips.
