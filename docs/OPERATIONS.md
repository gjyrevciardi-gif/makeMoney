# Production operations

## Services

The production Compose stack contains Caddy, Next.js, NestJS, PostgreSQL, and
Redis. PostgreSQL and Redis are on the private Compose network and have no host
ports. Caddy is the only public listener.

The backend container runs `prisma migrate deploy` before starting Nest. A
migration failure prevents the API from becoming healthy.

## Health and incident response

- `/health/live` only verifies that the process is serving.
- `/health/ready` verifies PostgreSQL and Redis. Sports-provider failure is
  reported separately and does not make the application unready.
- Capture the request ID response header when escalating an error.
- For a database outage, keep the frontend/API stopped or read-only until
  readiness returns; do not delete or recreate the volume.
- For Redis outage, restore Redis first because rate limits and worker locks
  depend on it.
- Provider outages are expected to surface as provider health failures; do not
  enable a real provider key in CI or local smoke tests.

## Backups and restore

Run `scripts/backup-postgres.sh` with `DATABASE_URL` and review the printed
artifact path. Backups are compressed, mode `0600` through `umask`, timestamped,
and retention-pruned.

Restore requires an explicit `RESTORE` confirmation:

```sh
DATABASE_URL='postgresql://...' scripts/restore-postgres.sh backups/file.dump.gz
npx prisma migrate status --schema backend/prisma/schema.prisma
node scripts/integrity-check.js
```

Restore into a disposable database first. Never automatically restore over
production.

## Integrity checks

`node scripts/integrity-check.js` is read-only. It checks wallet/ledger
reconciliation, negative balances, orphan relations, duplicate payouts, and
duplicate active casino configurations. A non-zero result blocks deployment.

## Updates and rollback

1. Create and verify a backup.
2. Pull the reviewed release.
3. Build images and run `docker compose -f docker-compose.prod.yml config`.
4. Start the database and Redis, then deploy the stack.
5. Confirm readiness, logs, and the smoke checks.

Application images can be rolled back. Prisma migrations are not assumed to
have a safe automatic rollback; use a forward fix or restore a verified backup.

## Admin bootstrap

There are no default credentials. On the first deployment only, temporarily set
`REGISTRATION_ENABLED=true`, create one account over HTTPS, and immediately set
it back to `false` and recreate the backend container. With no existing Admin,
run the one-time, transactionally audited bootstrap from the backend container:

```sh
docker compose -f docker-compose.prod.yml exec \
  -e BOOTSTRAP_ADMIN_EMAIL=operator@example.com \
  -e CONFIRM_ADMIN_BOOTSTRAP=GRANT_ADMIN \
  backend node scripts/bootstrap-admin.js
```

The script refuses to run if any Admin already exists. Verify the
`ADMIN_ROLE_GRANTED` audit event, test Admin access, and keep registration
disabled. Subsequent role changes require a separately reviewed operational
procedure; this bootstrap is intentionally not a general role-management tool.

## Dependency review

CI installs from `package-lock.json`. Review Dependabot pull requests, run
`npm audit --omit=dev` for runtime exposure and full `npm audit` for build/test
tooling, then rerun tests and builds before accepting upgrades. Do not apply
force upgrades blindly when they cross framework major versions.
