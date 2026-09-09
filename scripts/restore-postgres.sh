#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
backup="${1:?Usage: restore-postgres.sh /path/to/backup.dump.gz}"
test -f "$backup"
printf '%s\n' "This operation replaces the selected database. Type RESTORE to continue:"
read -r confirmation
test "$confirmation" = RESTORE
gzip -dc "$backup" | pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL"
printf '%s\n' "Restore completed. Run prisma migrate status and the integrity checker before serving traffic."
