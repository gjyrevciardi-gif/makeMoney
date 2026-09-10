# Fool's Gold Club

Private free-to-play sportsbook using non-redeemable virtual points. **Every new account starts at exactly 0 points.** Registration creates a user and an empty wallet atomically and creates no ledger entry. There is no welcome bonus, registration bonus, daily reward, faucet, or starting balance.

Points can be credited only by an authorized `ADMIN_GRANT`, a settled `SPORTS_WIN`/`CASINO_WIN`, or an explicit void/rollback refund. Every mutation is an immutable, idempotent ledger event. A zero-balance bet returns `INSUFFICIENT_VIRTUAL_BALANCE`.

Authentication uses 15-minute access tokens and rotating 30-day refresh-token families. Refresh tokens are stored only as SHA-256 hashes and delivered in an `HttpOnly; Secure; SameSite=Strict; Path=/auth` cookie. See [SECURITY.md](SECURITY.md).

## Requirements

- Node.js 22+ (verified with 24.13.0)
- npm 10+ (verified with 11.6.2)
- Docker with Compose

## Setup

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run prisma:generate -w backend
npm run prisma:migrate -w backend -- --name init
npm run start:dev -w backend
```

In a second terminal:

```powershell
npm run dev -w frontend
```

Backend: `http://localhost:3001`; frontend: `http://localhost:3000`.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

The checked-in seed intentionally creates no user, wallet, balance, or positive ledger event. Promote an account to `ADMIN` through a controlled operator/database process, then use the authenticated admin grant flow with a unique idempotency key and a reason.

See [MILESTONE-1.md](MILESTONE-1.md) for the corrected milestone definition.

## Production deployment

Production uses `docker-compose.prod.yml`: Caddy terminates HTTPS, the
frontend and backend run as non-root containers, and PostgreSQL/Redis remain
internal-only. A normal VPS deployment procedure is in
[docs/VPS-DEPLOYMENT.md](docs/VPS-DEPLOYMENT.md). Read
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md),
[docs/OPERATIONS.md](docs/OPERATIONS.md), and
[docs/SECURITY.md](docs/SECURITY.md) before deploying. Never copy `.env`,
`.env.production`, or real credentials into Git.

Before launch, confirm:

- DNS points `DOMAIN` and `api.DOMAIN` at the VPS.
- The firewall allows SSH from an operator-controlled source, plus TCP 80 and
  TCP 443; PostgreSQL 5432 and Redis 6379 are not public.
- Production registration is disabled after the controlled Admin bootstrap.
- `docker compose ... config`, migrations, readiness, the integrity checker,
  backups, and the non-destructive smoke test all pass.
- The operator has recorded the current release, backup artifact, and rollback
  decision.

Use `scripts/smoke.sh` only for non-destructive checks. It never places bets,
starts casino rounds, grants points, or changes Admin state.

## Sports data and virtual bets

Set `THE_ODDS_API_KEY` to enable real sports data. Browser code calls only this application's API; provider credentials remain in the backend. Sports, event, and odds responses are validated and normalized before being cached in Redis. Decimal odds are transported as strings and persisted with Prisma `Decimal`.

Authenticated users can submit `POST /bets` with selection identifiers, last-seen odds, an integer stake, and an idempotency key. The backend reloads authoritative odds, rejects changed/stale/unavailable selections, calculates accumulator odds exactly, and floors the final potential return to whole virtual points. Bet creation, wallet debit, immutable `SPORTS_BET` ledger entry, legs, and audit record are one PostgreSQL transaction.

## Sportsbook settlement

Set `SPORTS_SETTLEMENT_ENABLED=true` to enable the in-process result polling worker and configure `SPORTS_SETTLEMENT_POLL_SECONDS` (minimum 30 seconds). It groups open legs by provider event, retrieves one normalized result per event, persists it, and evaluates only `h2h`, `totals`, and `spreads`. Partial and postponed results remain open; authoritative cancellations void legs. Winning and all-void payouts use deterministic ledger keys and a PostgreSQL advisory transaction lock, so retries and concurrent workers cannot pay twice. Administrators can invoke the same worker through `POST /admin/sports/settlement/run`.

The Odds API scores endpoint supports completed scores but does not provide a reliable cancellation/postponement distinction in its documented score shape. Those states remain available in the provider-independent result contract for providers that can authoritatively supply them; they are never inferred from missing odds or elapsed time.
