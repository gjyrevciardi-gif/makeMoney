#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
umask 077

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/fools-gold-$timestamp.dump.gz"
tmp="$target.tmp"

cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | gzip -c > "$tmp"
test -s "$tmp"
mv "$tmp" "$target"
find "$BACKUP_DIR" -type f -name 'fools-gold-*.dump.gz' -mtime +"$RETENTION_DAYS" -delete
printf '%s\n' "$target"
