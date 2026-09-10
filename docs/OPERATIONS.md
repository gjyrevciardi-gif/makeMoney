# Production operations

## Service topology and normal checks

The production Compose stack contains Caddy, Next.js, NestJS, PostgreSQL, and
Redis. PostgreSQL and Redis are private Compose services with no host ports;
Caddy is the only public listener. Check the stack and recent logs with:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 caddy
curl -fsS https://DOMAIN/health/live
curl -fsS https://api.DOMAIN/health/ready
```

`/health/live` proves that the process is serving. `/health/ready` checks
PostgreSQL and Redis. A sports-provider outage is reported separately and
does not make the core application unready. Preserve the `X-Request-Id`
response header when escalating an incident.

## Incident response

### Application unavailable

Check container state, readiness, and backend logs. If the backend repeatedly
restarts, inspect the first startup error before restarting again. Do not
delete volumes. If only Caddy is unhealthy, inspect certificate, DNS, and
proxy logs separately from application logs.

### PostgreSQL unavailable

Readiness should fail. Check the PostgreSQL health check, disk space, volume
mount, and credentials without printing them. Do not run destructive reset
commands. Restore PostgreSQL service or fail over to a verified recovery
instance, then run `prisma migrate status` and the read-only integrity checker
before serving traffic.

### Redis unavailable

Readiness should fail because rate limits and distributed worker locks depend
on Redis. Check the Redis health check, password, memory, and persistent
volume. Restore Redis first; do not flush the database or Redis as an incident
shortcut.

### Sports provider outage

Check provider status and quota telemetry. Keep the application available for
account and casino operations if readiness is healthy, but expect sports
lists/odds to be stale or unavailable. Do not bypass backend odds validation,
invent results, or put provider keys in frontend configuration.

### Sports settlement backlog

Inspect `POST /admin/sports/settlement/run` and the operations status endpoints
using a controlled Admin account. Check provider failures, Redis lock health,
and database latency. The worker uses a distributed Redis lease and
database-side idempotency; do not run ad-hoc payout SQL or manually mark
results.

### Crash worker issue

Check `CASINO_CRASH_WORKER_ENABLED`, Redis readiness, worker logs, and the
distributed lock. Crash settlement relies on authoritative server timestamps
and idempotent database settlement, not browser clocks. Do not edit hidden
round state or outcome data.

### Migration failure

The backend runs `prisma migrate deploy` before Nest starts, so a failed
migration must prevent a healthy backend. Inspect the migration error and
database connectivity, take a backup if the database is healthy, and resolve
the migration with a reviewed forward migration. Never substitute
`prisma migrate dev` in production.

### Backup failure

Treat a missing or zero-byte backup as a failed backup. Check database
connectivity, backup directory permissions, free space, retention settings,
and off-host copy status. Do not delete the last known-good backup until a
new artifact is verified.

### Disk full

Check `df -h`, Docker image/container logs, PostgreSQL volume usage, and the
backup directory. Stop creating new backups if the target filesystem is full,
preserve evidence, rotate only verified old logs/artifacts, and expand or
attach storage. Never delete PostgreSQL data files manually.

### Bad deployment

Stop rollout, preserve logs and the release identifier, and compare readiness
and smoke results with the previous release. Roll back application images/code
when safe. Database migrations are not assumed to roll back automatically;
use a reviewed forward fix or restore a verified backup into a controlled
recovery process.

## Backups and restore

Run `scripts/backup-postgres.sh` with `DATABASE_URL`. It creates a
timestamped compressed custom-format dump with restrictive permissions and
prunes artifacts older than `BACKUP_RETENTION_DAYS`. Copy verified backups
off-host and encrypt them at rest.

Restore only after an explicit operator decision, preferably into a disposable
database first:

```sh
DATABASE_URL='postgresql://...' scripts/restore-postgres.sh backups/file.dump.gz
npx prisma migrate status --schema backend/prisma/schema.prisma
node scripts/integrity-check.js
```

The restore script requires the literal confirmation `RESTORE`. Restore does
not replace migration review, integrity checks, or smoke checks.

## Updates, rollback, and disaster recovery

For an update: create and verify a backup, pull the reviewed release, render
and build Compose, deploy the migration, restart the application, then check
readiness, logs, and `scripts/smoke.sh`. Keep the previous application image
available until the new release is accepted.

For rollback, revert application images/code first when the schema remains
compatible. If a migration is incompatible, use a reviewed forward fix or
restore a verified database backup; do not pretend Prisma supports arbitrary
automatic rollback.

For disaster recovery, provision a new VPS, install Docker, restore the
repository and a separately managed `.env.production`, restore PostgreSQL
into a clean database, run `prisma migrate status`, start Redis/backend/frontend
and Caddy, run `node scripts/integrity-check.js`, then verify live/ready health
and the smoke checks before changing DNS.

## Time and clock operations

Backend timestamps are UTC. Enable NTP/systemd-timesyncd or chrony on the VPS
and verify the host clock after provisioning and after resume/reboot. Crash
timing and settlement use authoritative server/database time; browser clocks
must never determine outcomes.

## Admin bootstrap and private platform

There are no default Admin credentials or shared passwords. Keep
`REGISTRATION_ENABLED=false` in production. For a first deployment only,
temporarily enable registration over HTTPS, create the controlled operator
account, disable registration immediately, and recreate the backend. If no
Admin exists, use the audited one-time bootstrap:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec \
  -e BOOTSTRAP_ADMIN_EMAIL=operator@example.com \
  -e CONFIRM_ADMIN_BOOTSTRAP=GRANT_ADMIN \
  backend node scripts/bootstrap-admin.js
```

The script refuses to run when an Admin already exists. Verify the
`ADMIN_ROLE_GRANTED` audit event, test Admin access, and remove temporary
bootstrap values. Every new user starts at exactly zero points; no welcome
bonus or faucet is created.

## Pre-launch checklist

- [ ] DNS and HTTPS certificate resolve for both application domains.
- [ ] Firewall allows only required SSH, 80, and 443; 5432/6379 are private.
- [ ] Production secrets are random, unique, uncommitted, and not in logs.
- [ ] Registration is disabled and the initial Admin is verified.
- [ ] Compose config/build, migrations, health, smoke, and integrity checks pass.
- [ ] A compressed backup was created, restored in a disposable database, and
      copied off-host.
- [ ] NTP is synchronized and the release/rollback plan is recorded.
