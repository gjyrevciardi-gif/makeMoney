#!/usr/bin/env sh
# Restore a backup produced by backup-postgres.sh.
#
# The default is deliberately non-destructive: it restores into a database that
# is already empty and refuses to touch one that holds data. Overwriting a
# populated database is a separate, explicitly requested mode that additionally
# requires the operator to type the target database's own name.
#
#   Safe (default) — restore into an empty recovery database:
#     DATABASE_URL=... scripts/restore-postgres.sh backup.dump.gz
#
#   Destructive — drop and replace the contents of a populated database:
#     DATABASE_URL=... RESTORE_MODE=destructive scripts/restore-postgres.sh backup.dump.gz
#     (prompts for confirmation, or set RESTORE_CONFIRM="RESTORE <dbname>")
set -eu
set +x

: "${DATABASE_URL:?DATABASE_URL is required}"
backup="${1:?Usage: restore-postgres.sh /path/to/backup.dump.gz}"
test -f "$backup"

RESTORE_MODE="${RESTORE_MODE:-safe}"

# Strip the query string and any path prefix to recover the bare database name.
target_name="${DATABASE_URL##*/}"
target_name="${target_name%%\?*}"
if [ -z "$target_name" ]; then
  printf '%s\n' "Could not determine the target database name from DATABASE_URL" >&2
  exit 1
fi

work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT HUP INT TERM

# Decompress to a file first: in POSIX sh a `gzip -dc | pg_restore` pipeline
# hides a gzip failure behind pg_restore's exit status.
archive="$work/restore.dump"
gzip -dc "$backup" >"$archive"
test -s "$archive"
pg_restore --list "$archive" >/dev/null

# As in the backup script, the URI has to be passed on the command line and is
# therefore visible in `ps` to local users on the host.
user_tables="$(psql --dbname="$DATABASE_URL" --no-psqlrc --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')")"

case "$RESTORE_MODE" in
  safe)
    if [ "$user_tables" -ne 0 ]; then
      printf '%s\n' \
        "Refusing to restore: \"$target_name\" already contains $user_tables table(s)." \
        "The default mode only restores into an empty recovery database." \
        "Create an empty database and point DATABASE_URL at it, or if you truly" \
        "intend to overwrite this one, re-run with RESTORE_MODE=destructive." >&2
      exit 1
    fi
    ;;
  destructive)
    expected="RESTORE $target_name"
    confirmation="${RESTORE_CONFIRM:-}"
    if [ -z "$confirmation" ]; then
      if [ ! -t 0 ]; then
        printf '%s\n' \
          "Destructive restore needs confirmation but stdin is not a terminal." \
          "Set RESTORE_CONFIRM to exactly: $expected" >&2
        exit 1
      fi
      printf '%s\n' \
        "This REPLACES every table in the database \"$target_name\" ($user_tables table(s) present)." \
        "Type the following exactly to continue: $expected"
      read -r confirmation
    fi
    # Requiring the database's own name means muscle memory alone cannot carry
    # an operator through this prompt against the wrong target.
    if [ "$confirmation" != "$expected" ]; then
      printf '%s\n' "Confirmation did not match. Nothing was changed." >&2
      exit 1
    fi
    ;;
  *)
    printf '%s\n' "RESTORE_MODE must be 'safe' or 'destructive' (got '$RESTORE_MODE')" >&2
    exit 1
    ;;
esac

# --single-transaction makes the restore all-or-nothing: a failure part way
# through rolls back and leaves the target exactly as it was.
set -- --no-owner --no-privileges --single-transaction --exit-on-error
if [ "$RESTORE_MODE" = destructive ]; then
  set -- "$@" --clean --if-exists
fi

pg_restore --dbname="$DATABASE_URL" "$@" "$archive"

printf '%s\n' \
  "Restore completed into \"$target_name\" (mode: $RESTORE_MODE)." \
  "Run 'prisma migrate status' and scripts/integrity-check.js before serving traffic."
