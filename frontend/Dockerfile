# syntax=docker/dockerfile:1
#
# Production frontend image. Next.js `output: 'standalone'` emits a self-contained
# server plus only the traced dependencies, so the runtime stage carries no build
# toolchain and no `next dev`.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Only NEXT_PUBLIC_* values may be baked in: everything inlined here is readable
# by anyone who opens the bundle, so no backend secret is ever passed as a build
# argument. The browser talks to the API through this public URL and never holds
# a database, Redis, JWT, or provider credential.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace frontend --include-workspace-root=false
COPY frontend frontend
RUN npm run build -w frontend

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
# `outputFileTracingRoot` is the repository root, so the standalone bundle keeps
# the workspace layout and the server entrypoint lands at frontend/server.js.
COPY --from=build --chown=app:app /app/frontend/.next/standalone ./
COPY --from=build --chown=app:app /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=app:app /app/frontend/public ./frontend/public

USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "frontend/server.js"]
