# VPS deployment

1. Provision a supported Linux VPS and install Docker Engine plus Compose.
2. Configure DNS for `DOMAIN` and `api.DOMAIN` to the VPS address.
3. Allow SSH, TCP 80, and TCP 443 in the firewall. Do not expose 5432 or 6379.
4. Copy the repository and create `.env.production` from
   `.env.production.example`. Never reuse the development `.env`.
5. Set strong unique PostgreSQL, Redis, JWT, and provider credentials. Set
   `COOKIE_SECURE=true`, `REGISTRATION_ENABLED=false` after admin bootstrap,
   `DOMAIN`, and `ADMIN_EMAIL`. URL-encode reserved password characters in
   `DATABASE_URL` and `REDIS_URL`; the raw service passwords remain in
   `POSTGRES_PASSWORD` and `REDIS_PASSWORD`.
6. Build and validate:

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml config
   docker compose --env-file .env.production -f docker-compose.prod.yml build
   ```

7. Start PostgreSQL and Redis and wait for health checks:

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
   ```

8. Start the application. Backend migration deployment runs before Nest:

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d
   ```

9. Verify `https://DOMAIN`, `https://DOMAIN/health/live`, and
   `https://DOMAIN/health/ready`. Verify the API through `https://api.DOMAIN`.
10. Perform a non-destructive smoke test, sign in as the controlled Admin, and
    confirm provider-unconfigured behavior is graceful.
11. Configure scheduled backups using `scripts/backup-postgres.sh` and copy
    encrypted backups off-host.

Run the non-mutating smoke checks with:

```sh
BASE_URL=https://example.com API_URL=https://api.example.com scripts/smoke.sh
```

For updates, backup first, build the new images, deploy, check health, then
inspect logs. For disaster recovery, provision a new VPS, restore the
environment and database backup into a fresh recovery database using the
default safe restore mode, verify migrations and integrity, then start the
stack. Do not assume Prisma provides automatic migration rollback.

Use the real restore contract:

```sh
DATABASE_URL='postgresql://...' scripts/restore-postgres.sh backups/file.dump.gz
npx prisma migrate status --schema backend/prisma/schema.prisma
node scripts/integrity-check.js
```

Safe mode refuses populated databases. An intentional overwrite requires
`RESTORE_MODE=destructive` and an exact confirmation matching the target
database name, either interactively or with
`RESTORE_CONFIRM='RESTORE <database_name>'`. Run
`scripts/backup-restore-drill.sh` to exercise backup, archive validation,
safe recovery, destructive confirmation, and integrity verification against
throwaway PostgreSQL containers.
