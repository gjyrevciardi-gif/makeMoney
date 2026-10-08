# Buyer demo — operator cheat sheet

Local-only presentation build. Virtual points throughout; no real money, no real
payment path. Nothing here touches the dev, CI or production databases: the demo
runs its own Docker project (`totobuyerdemo`) on its own ports.

---

## A. Start

```bash
cd C:\Users\Admin\Desktop\toto-buyer-demo
npm run demo:up
```

First run generates `.env.demo` (gitignored), starts Postgres + Redis, applies
migrations, builds both apps, starts the servers and seeds the demo accounts.
Later runs skip the build — add `-- --rebuild` to force one.

## B. URL

**http://127.0.0.1:3020** — use the IP, not `localhost`.

> On this machine `localhost` resolves to `::1` first while the containers publish
> IPv4 only, which costs ~2 seconds on every new connection.

API (not needed for the demo): http://127.0.0.1:3021

## C. Accounts

| Role | Email | Can show |
|---|---|---|
| ADMIN | `demo-admin@foolsgold.local` | admin pages, grants, casino config, audit |
| PLAYER | `demo-player@foolsgold.local` | sportsbook, live, casino, my bets |

Passwords are in `.env.demo` as `DEMO_ADMIN_PASSWORD` and `DEMO_PLAYER_PASSWORD`.
That file is gitignored and generated per machine — **do not paste it into chat,
tickets or slides.** The PLAYER is funded with 100,000 PTS via a normal
`ADMIN_GRANT` ("Buyer demo funding"), so it appears in the ledger and audit trail
like any other grant. New registrations still start at 0.

## D. Reset to a known state

```bash
npm run demo:reset
```

Recreates the demo schema, re-runs migrations, flushes demo Redis, re-registers
both accounts through the normal registration flow, re-bootstraps the admin and
re-grants the 100,000 PTS. It refuses to run against anything other than
`fools_gold_demo` on loopback port 55440, and refuses `NODE_ENV=production`.

`npm run demo:status` shows what is running and what the accounts hold.

## E. Ten-minute running order

1. **Landing** (`/`) — brand, and that Sports / Live / Casino / My Bets are one product.
2. **Sports** (`/sports`) — pick the competition, open the rich fixture from preflight.
3. **Event page** — market groups (Match Result, Goals, Halves, Correct Score), real prices, named bookmaker.
4. **Single bet** — tap a price, stake 250, Place bet. Show the header balance drop.
5. **My Bets** — the bet appears as SINGLE / OPEN with its stake.
6. **Accumulator** — add a second selection, switch to Accumulator, show Total odds and Estimated return.
7. **Live** (`/live`) — LIVE badge, real score, elapsed minute, `+N Markets`, suspended prices greyed out.
8. **Casino** (`/casino`) — Crash, Mines, Fool's Gold Rush, Roulette.
9. **External Demo section** — provider-hosted demos, clearly badged, opening in a new tab.
10. **Admin** (`/admin`) — users and balances, grant/remove, casino config versioning, provider health, audit trail.

## F. Which fixture to show

Run the preflight (§J) — it names the current best pre-match and live fixtures
with their market counts and gives you direct links. Fixtures change constantly,
so **do not** rely on a fixture written down here.

At the last check the sportsbook was serving ~326 real events, with pre-match
fixtures carrying 47–55 provider markets and live fixtures 55–85.

## G. Games to demonstrate

**Showcase first:** Crash (rising multiplier + cash out), Mines (tile reveals +
cash out), Fool's Gold Rush (5×3 reels), Roulette (bet board + spin).
**Then, if asked:** Dice, Blackjack, Plinko.

**External Demo** cards are provider-hosted public demos (Pragmatic Play,
Play'n GO). They are clearly badged, open in a new tab, and are *not* connected
to the Fool's Gold wallet — say so plainly if the buyer asks; it is a strength,
not an apology.

## H. What not to do during the demo

- Don't promise a live fixture without checking preflight first — sometimes nothing is in play.
- Don't hammer **Refresh** on sports pages; prices are cached deliberately to protect provider quota.
- Don't open `localhost:3020` (use the IP) and don't open the API port in front of the buyer.
- Don't run `demo:reset` mid-presentation — it wipes the bet history you just created.
- Don't show `.env.demo` on screen.
- Don't claim the external provider demos are integrated with our wallet.
- Don't promise settlement of the bet placed on stage: automatic sports settlement is off in the demo profile.

## I. Stop

```bash
npm run demo:down
```

Stops both servers and the demo containers. The data volume is kept, so
`npm run demo:up` brings the same state back.

## J. Preflight — run 10–15 minutes before

```bash
npm run demo:preflight
```

It checks the stack, confirms the PLAYER still holds 100,000 PTS, reports both
providers and their remaining quota, warms the odds cache for the fixtures it
recommends, names the best pre-match and live events with direct links, and
re-checks every external demo link. Then:

- leave the PLAYER logged in with `/sports` open,
- keep the preflight output beside you for the fixture links,
- if it reports a broken external demo link, skip that card.

---

## Known issues, deliberately deferred

- **Backend suite flakiness (555/557).** Diagnosed but not fixed on this branch:
  `localhost` resolves to `::1` first while Docker publishes IPv4 only, so each
  new Postgres connection costs ~2.05s, which exceeds Prisma's 2s interactive
  transaction `maxWait` and surfaces as P2028. It only bites the one test that
  fires four simultaneous transactional requests. The demo stack sidesteps it
  entirely by using `127.0.0.1`. Pre-production follow-up, not a demo blocker.
- **Automatic sports settlement is off** in the demo profile
  (`SPORTS_SETTLEMENT_ENABLED=false`), so bets placed on stage stay OPEN.
