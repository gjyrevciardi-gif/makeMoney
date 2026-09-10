# syntax=docker/dockerfile:1
#
# Production backend image. The build stage compiles with the full toolchain; the
# runtime stage installs production dependencies only and never contains the
# TypeScript sources, the Nest CLI, or a watch mode.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma's engines link against OpenSSL and probe for it at generate time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# `npm ci` installs strictly from the lockfile, so the image is reproducible.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --workspace backend --include-workspace-root=false
COPY backend backend
RUN npx prisma generate --schema backend/prisma/schema.prisma && npm run build -w backend

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/prisma backend/prisma
COPY scripts scripts
# The generated client and its query engine come from the build stage; the
# `prisma` CLI used for `migrate deploy` comes from the production install.
COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build /app/node_modules/@prisma /app/node_modules/@prisma
COPY --chmod=0555 backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER app
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The entrypoint applies migrations and only then execs the server, so the
# container never serves traffic against an unmigrated database.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
