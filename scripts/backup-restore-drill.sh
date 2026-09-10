#!/usr/bin/env bash
# Prove that a backup taken by backup-postgres.sh actually restores.
#
# A backup nobody has restored is a hypothesis, not a backup. This drill runs
# the real scripts — not a reimplementation — against two throwaway PostgreSQL
# containers, then compares the restored database against the original.
#
# It never touches a development or production database: both endpoints are
# containers this script creates and destroys, published only on loopback and
# only on a port the Docker daemon assigns.
#
#   scripts/backup-restore-drill.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_IMAGE="postgres:16-alpine"
STAMP="$(date -u +%Y%m%d%H%M%S)-$$"
SOURCE_CONTAINER="drill-source-$STAMP"
TARGET_CONTAINER="drill-target-$STAMP"
NETWORK="drill-net-$STAMP"
# The backup artifact is handed between containers on a named volume rather than
# a host bind mount: a host temp path does not map into the Docker VM the same
# way on every platform, and the drill should behave identically everywhere.
BACKUP_VOLUME="drill-backups-$STAMP"
LOGDIR="$(mktemp -d)"
# Throwaway credential for containers that live only for this script.
PGPASS="drill_only_password"

log() { printf '\n=== %s ===\n' "$1"; }

cleanup() {
  docker rm -f "$SOURCE_CONTAINER" "$TARGET_CONTAINER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  docker volume rm "$BACKUP_VOLUME" >/dev/null 2>&1 || true
  rm -rf "$LOGDIR"
}
trap cleanup EXIT

start_instance() {
  local container="$1" database="$2"
  docker run -d --name "$container" --network "$NETWORK" -p 127.0.0.1:0:5432 \
    -e POSTGRES_USER=drill -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB="$database" \
    "$PG_IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    if docker exec "$container" pg_isready -U drill -d "$database" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  printf 'Timed out waiting for %s\n' "$container" >&2
  return 1
}

host_port() {
  docker port "$1" 5432 | head -1 | sed 's/.*://'
}

psql_in() {
  local container="$1" database="$2"
  shift 2
  docker exec -i -e PGPASSWORD="$PGPASS" "$container" \
    psql -U drill -d "$database" --no-psqlrc --tuples-only --no-align -v ON_ERROR_STOP=1 "$@"
}

on_volume() {
  docker run --rm -v "$BACKUP_VOLUME:/backups" "$PG_IMAGE" "$@"
}

run_script() {
  # Runs one of the real ops scripts with the real client tools, so what the
  # drill exercises is exactly what runs in production.
  docker run --rm --network "$NETWORK" \
    -v "$REPO_ROOT/scripts:/repo/scripts:ro" \
    -v "$BACKUP_VOLUME:/backups" \
    "$@"
}

# Row counts plus sums over the seeded rows: enough to catch a restore that
# silently dropped, duplicated, or altered data.
FINGERPRINT_SQL="SELECT 'users=' || (SELECT count(*) FROM \"User\")
  || ' wallets=' || (SELECT count(*) FROM \"Wallet\")
  || ' ledger=' || (SELECT count(*) FROM \"LedgerEntry\")
  || ' balance_sum=' || (SELECT COALESCE(SUM(balance), 0) FROM \"Wallet\")
  || ' ledger_sum=' || (SELECT COALESCE(SUM(amount), 0) FROM \"LedgerEntry\")
  || ' tables=' || (SELECT count(*) FROM pg_tables
                    WHERE schemaname NOT IN ('pg_catalog', 'information_schema'))"

log "Starting disposable PostgreSQL instances"
docker network create "$NETWORK" >/dev/null
docker volume create "$BACKUP_VOLUME" >/dev/null
start_instance "$SOURCE_CONTAINER" drill_source_test
start_instance "$TARGET_CONTAINER" drill_target_test

SOURCE_INTERNAL="postgresql://drill:$PGPASS@$SOURCE_CONTAINER:5432/drill_source_test"
TARGET_INTERNAL="postgresql://drill:$PGPASS@$TARGET_CONTAINER:5432/drill_target_test"

log "Applying migrations to the source database"
(
  cd "$REPO_ROOT"
  DATABASE_URL="postgresql://drill:$PGPASS@127.0.0.1:$(host_port "$SOURCE_CONTAINER")/drill_source_test?schema=public" \
    npx prisma migrate deploy --schema backend/prisma/schema.prisma
)

log "Seeding harmless drill data"
# Synthetic rows only. A drill never involves real user data.
psql_in "$SOURCE_CONTAINER" drill_source_test <<'SQL'
INSERT INTO "User" (id, email, "passwordHash", role)
VALUES ('11111111-1111-4111-8111-111111111111', 'drill-one@example.test', 'not-a-real-hash', 'USER'),
       ('22222222-2222-4222-8222-222222222222', 'drill-two@example.test', 'not-a-real-hash', 'USER'),
       ('66666666-6666-4666-8666-666666666666', 'drill-admin@example.test', 'not-a-real-hash', 'ADMIN');

INSERT INTO "Wallet" (id, "userId", balance)
VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 500),
       ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 0);

-- The schema requires an actor on every administrative movement, and the wallet
-- balance must equal the ledger sum, so the seed satisfies both: the drill
-- database is left in a state the integrity checker would also pass.
INSERT INTO "LedgerEntry" (id, "walletId", type, amount, reason, "actorId", "idempotencyKey")
VALUES ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333',
        'ADMIN_GRANT', 500, 'drill seed', '66666666-6666-4666-8666-666666666666', 'drill-seed-1');
SQL

source_fingerprint="$(psql_in "$SOURCE_CONTAINER" drill_source_test -c "$FINGERPRINT_SQL")"
log "Source fingerprint"
printf '%s\n' "$source_fingerprint"

log "Running scripts/backup-postgres.sh inside a PostgreSQL container"
run_script \
  -e DATABASE_URL="$SOURCE_INTERNAL" \
  -e BACKUP_DIR=/backups \
  -e BACKUP_RETENTION_DAYS=1 \
  "$PG_IMAGE" sh /repo/scripts/backup-postgres.sh

backup_name="$(on_volume sh -c 'ls -1 /backups/fools-gold-*.dump.gz 2>/dev/null | head -1' | xargs -r basename)"
if [ -z "$backup_name" ]; then
  printf 'No backup artifact was produced\n' >&2
  exit 1
fi
size="$(on_volume stat -c '%s' "/backups/$backup_name")"
mode="$(on_volume stat -c '%a' "/backups/$backup_name")"
printf 'Backup artifact: %s (%s bytes, mode %s)\n' "$backup_name" "$size" "$mode"
if [ "$mode" != "600" ]; then
  printf 'Backup artifact is not owner-only readable (mode %s)\n' "$mode" >&2
  exit 1
fi

log "Checking that a failed dump cannot masquerade as a backup"
# Point the backup at a database that does not exist. The script must exit
# non-zero and leave no artifact behind, rather than writing an empty gzip.
before="$(on_volume sh -c 'ls -1 /backups | wc -l')"
if run_script \
  -e DATABASE_URL="postgresql://drill:$PGPASS@$SOURCE_CONTAINER:5432/no_such_database" \
  -e BACKUP_DIR=/backups \
  "$PG_IMAGE" sh /repo/scripts/backup-postgres.sh >"$LOGDIR/failed-backup.log" 2>&1; then
  printf 'Backup reported success against a nonexistent database\n' >&2
  exit 1
fi
after="$(on_volume sh -c 'ls -1 /backups | wc -l')"
printf 'Failed as expected; artifacts before=%s after=%s\n' "$before" "$after"
if [ "$before" != "$after" ]; then
  printf 'A failed backup left an artifact behind\n' >&2
  exit 1
fi

log "Checking that safe mode refuses a populated database"
# Restoring over the populated source must be rejected by default; only the
# explicit destructive mode may overwrite anything.
if run_script \
  -e DATABASE_URL="$SOURCE_INTERNAL" \
  "$PG_IMAGE" sh /repo/scripts/restore-postgres.sh "/backups/$backup_name" \
  >"$LOGDIR/refusal.log" 2>&1; then
  printf 'Safe mode restored into a populated database; it should have refused\n' >&2
  cat "$LOGDIR/refusal.log" >&2
  exit 1
fi
printf 'Refused as expected: %s\n' "$(head -1 "$LOGDIR/refusal.log")"

log "Checking that destructive mode refuses a mismatched confirmation"
if run_script \
  -e DATABASE_URL="$SOURCE_INTERNAL" \
  -e RESTORE_MODE=destructive \
  -e RESTORE_CONFIRM="RESTORE some_other_database" \
  "$PG_IMAGE" sh /repo/scripts/restore-postgres.sh "/backups/$backup_name" \
  >"$LOGDIR/wrong-confirm.log" 2>&1; then
  printf 'Destructive mode accepted a confirmation naming a different database\n' >&2
  exit 1
fi
printf 'Refused as expected: %s\n' "$(head -1 "$LOGDIR/wrong-confirm.log")"

log "Restoring into the clean target database"
run_script \
  -e DATABASE_URL="$TARGET_INTERNAL" \
  "$PG_IMAGE" sh /repo/scripts/restore-postgres.sh "/backups/$backup_name"

target_fingerprint="$(psql_in "$TARGET_CONTAINER" drill_target_test -c "$FINGERPRINT_SQL")"
log "Restored fingerprint"
printf '%s\n' "$target_fingerprint"

if [ "$source_fingerprint" != "$target_fingerprint" ]; then
  printf '\nDRILL FAILED: the restored database does not match the source\n' >&2
  exit 1
fi

log "Restoring destructively over the now-populated target"
# The riskiest path in the whole script: --clean --if-exists inside a single
# transaction, over a database that already holds the schema. Exercised here
# with the correct confirmation so the drill covers it rather than assuming it.
run_script \
  -e DATABASE_URL="$TARGET_INTERNAL" \
  -e RESTORE_MODE=destructive \
  -e RESTORE_CONFIRM="RESTORE drill_target_test" \
  "$PG_IMAGE" sh /repo/scripts/restore-postgres.sh "/backups/$backup_name"

destructive_fingerprint="$(psql_in "$TARGET_CONTAINER" drill_target_test -c "$FINGERPRINT_SQL")"
printf 'After destructive restore: %s\n' "$destructive_fingerprint"
if [ "$source_fingerprint" != "$destructive_fingerprint" ]; then
  printf '\nDRILL FAILED: the destructive restore did not reproduce the source\n' >&2
  exit 1
fi

log "Verifying the restored migration history"
applied="$(psql_in "$TARGET_CONTAINER" drill_target_test \
  -c 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')"
printf 'Applied migrations present in the restore: %s\n' "$applied"
if [ "$applied" -lt 1 ]; then
  printf '\nDRILL FAILED: the restored database has no migration history\n' >&2
  exit 1
fi

log "Running the integrity checker against the restored database"
(
  cd "$REPO_ROOT"
  DATABASE_URL="postgresql://drill:$PGPASS@127.0.0.1:$(host_port "$TARGET_CONTAINER")/drill_target_test?schema=public" \
    node scripts/integrity-check.js
)

printf '\nDRILL PASSED: backup verified, a failed dump produced no artifact, safe mode refused an occupied target, destructive mode refused a mismatched confirmation, and the restore matched the source.\n'
