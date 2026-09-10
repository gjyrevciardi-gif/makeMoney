#!/usr/bin/env sh
# Take a compressed, verified, timestamped backup of the application database.
#
# Exits non-zero on any failure. A backup that did not complete must never look
# like one that did, because the only thing worse than no backup is a directory
# full of files that cannot be restored.
set -eu
# DATABASE_URL carries the database password; refuse to trace it even if the
# caller invoked this script with `sh -x`.
set +x

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

case "$RETENTION_DAYS" in
  '' | *[!0-9]*)
    printf '%s\n' "BACKUP_RETENTION_DAYS must be a whole number of days" >&2
    exit 1
    ;;
esac

# Restrict before creating anything, so the directory itself is not world
# readable either.
umask 077
mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/fools-gold-$timestamp.dump.gz"
raw="$target.raw"
tmp="$target.tmp"

cleanup() { rm -f "$raw" "$tmp"; }
trap cleanup EXIT HUP INT TERM

# pg_dump writes to a file rather than through a pipe on purpose. POSIX sh has
# no `pipefail`, so `pg_dump | gzip > out` reports only gzip's exit status: a
# pg_dump that died would still leave a valid, nearly empty gzip behind and this
# script would report success. Writing to a file makes pg_dump's own status the
# one `set -e` acts on.
# Note: the URI appears in this process's argv, so any local user can see it
# with `ps`. That is libpq's only reliable way to accept a full connection
# string; run backups under a dedicated account rather than a shared login.
pg_dump --format=custom --no-owner --no-privileges --file="$raw" --dbname="$DATABASE_URL"

test -s "$raw"

# Reading the archive's table of contents proves it is a complete, parseable
# dump. A truncated or corrupt file fails here, at backup time, instead of
# during the restore that someone is depending on.
pg_restore --list "$raw" >/dev/null

gzip -c "$raw" >"$tmp"
test -s "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$target"
rm -f "$raw"

# Retention runs only after a confirmed-good backup exists, so a failed run can
# never be the thing that expires the last good one.
find "$BACKUP_DIR" -type f -name 'fools-gold-*.dump.gz' -mtime +"$RETENTION_DAYS" -delete

printf '%s\n' "$target"
