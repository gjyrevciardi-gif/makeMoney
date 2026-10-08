# VPS deployment guide

This guide targets one normal Linux VPS running Docker Compose. It does not
require Kubernetes.

## 1. Provision the host

Use a supported 64-bit Linux distribution, attach persistent storage, and
install Docker Engine and the Compose plugin from the vendor instructions.
Enable NTP (`systemd-timesyncd` or `chrony`) and verify UTC time before
starting the stack.

Configure the host firewall. Permit SSH only from the operator network when
possible, plus TCP 80 and TCP 443:

```sh
sudo ufw allow from OPERATOR_CIDR to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

UDP 443 is needed only if you want HTTP/3; Caddy publishes it and falls back to
TCP without it. Do not allow or publish TCP 5432 or TCP 6379. PostgreSQL and
Redis are internal Compose services with no host port bindings at all.

## 2. DNS and configuration

Point `DOMAIN` and `api.DOMAIN` DNS records at the VPS. Clone the reviewed
release, copy `.env.production.example` to `.env.production`, and edit it
only on the VPS:

```sh
cp .env.production.example .env.production
chmod 600 .env.production
```

Set unique random PostgreSQL, Redis, JWT access, and JWT refresh secrets.
Set `DOMAIN`, `ADMIN_EMAIL`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, and
`REGISTRATION_ENABLED=false` after the controlled initial Admin bootstrap.
`TRUST_PROXY` is the number of proxy hops to trust and must match the stack in
front of the backend — one Caddy container here. Startup rejects any other
shape, and no value trusts the whole forwarded chain.
URL-encode reserved characters in `DATABASE_URL` and `REDIS_URL`. Never put
real credentials in Git or in this guide.

`ADMIN_EMAIL` is the ACME account address Caddy registers with Let's Encrypt.
It must be a real mailbox on a public top-level domain; an internal TLD is
rejected at registration and no certificate is ever issued. To rehearse the
stack on a host the public internet cannot reach, set
`CADDY_GLOBAL_OPTIONS=local_certs` so Caddy signs with its internal CA instead
of attempting a challenge it cannot pass. Leave it unset in production.

## 3. Render, build, and start

Validate the expanded configuration and build both application images:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

The backend container runs `prisma migrate deploy` before starting Nest. A
migration failure prevents the backend from becoming healthy. Never run
`prisma migrate dev` in production.

## 4. Verify the deployment

Wait for all service health checks, then verify:

```sh
curl -fsS https://DOMAIN/health/live
curl -fsS https://api.DOMAIN/health/ready
BASE_URL=https://DOMAIN API_URL=https://api.DOMAIN scripts/smoke.sh
node scripts/integrity-check.js
```

Confirm HTTPS certificate negotiation and redirects with
`curl -I https://DOMAIN` and `curl -I https://api.DOMAIN`. Check Caddy and
backend logs, and preserve request IDs for any failures.

## 5. Backups and Admin verification

Schedule `scripts/backup-postgres.sh` with a service account, a restrictive
backup directory, retention, and encrypted off-host copies. Test each new
backup with `scripts/backup-restore-drill.sh` before relying on it for
disaster recovery. The drill uses disposable PostgreSQL containers.

Restore production data into a fresh recovery database by default:

```sh
DATABASE_URL='postgresql://...' scripts/restore-postgres.sh backups/file.dump.gz
npx prisma migrate status --schema backend/prisma/schema.prisma
node scripts/integrity-check.js
```

Safe mode refuses populated databases. An intentional overwrite requires
`RESTORE_MODE=destructive` and an exact confirmation matching the target
database name, either at the prompt or through
`RESTORE_CONFIRM='RESTORE <database_name>'`. Never assume Prisma migrations
provide automatic rollback.

There are no default Admin credentials. For the first deployment only, either
temporarily enable registration over HTTPS and create the operator account, or
run the audited `scripts/bootstrap-admin.js` command documented in
`docs/OPERATIONS.md`. Immediately disable registration, recreate the backend,
verify Admin access and the `ADMIN_ROLE_GRANTED` audit event, and confirm that
new ordinary users start at exactly zero points.

Never place wagers, start casino rounds, grant points, or alter outcomes as
part of smoke testing.
