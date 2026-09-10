#!/bin/sh
# Production start sequence for the backend container.
#
# Migrations are applied with `migrate deploy`, never `migrate dev`: deploy only
# replays committed migration files and never rewrites history or resets data.
# The application is exec'd only once the database is confirmed to match this
# build, so a half-applied or failed migration keeps the container out of the
# load balancer instead of serving traffic against a schema it does not expect.
set -eu

SCHEMA="backend/prisma/schema.prisma"
PRISMA="node_modules/.bin/prisma"

log() {
  printf '{"event":"%s","detail":"%s"}\n' "$1" "$2"
}

if [ "${NODE_ENV:-}" != "production" ]; then
  log STARTUP_REFUSED "NODE_ENV must be production in this image"
  exit 1
fi

log MIGRATION_DEPLOY_STARTED "$SCHEMA"
if ! "$PRISMA" migrate deploy --schema "$SCHEMA"; then
  log MIGRATION_DEPLOY_FAILED "refusing to start"
  exit 1
fi

# `migrate deploy` returns success once it has applied what it could. Only
# `migrate status` reports a failed or drifted migration state, so it is the
# check that actually gates startup.
if ! "$PRISMA" migrate status --schema "$SCHEMA"; then
  log MIGRATION_STATE_INCOMPATIBLE "refusing to start"
  exit 1
fi

log MIGRATION_DEPLOY_COMPLETED "database is up to date"

# exec so the Node process becomes PID 1 and receives SIGTERM directly, which is
# what drives the graceful shutdown path.
exec node backend/dist/src/main.js
