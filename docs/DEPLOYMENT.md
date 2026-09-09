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
   docker compose -f docker-compose.prod.yml config
   docker compose -f docker-compose.prod.yml build
   ```

7. Start PostgreSQL and Redis and wait for health checks:

   ```sh
   docker compose -f docker-compose.prod.yml up -d postgres redis
   ```

8. Start the application. Backend migration deployment runs before Nest:

   ```sh
   docker compose -f docker-compose.prod.yml up -d
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
environment and database backup into a clean database, run migrations and the
integrity checker, then start the stack.
