# syntax=docker/dockerfile:1
#
# Classic gateway runtime. This image contains only the first-party gateway
# program (server, entry page, recovery bridge). The recovered Book of Ra
# cabinet is not copied in. A private local Compose file may bind-mount that
# directory; a production image must not distribute it.

FROM node:22-bookworm-slim
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --chown=app:app \
  games/book-of-ra-classic/gateway/server.mjs \
  games/book-of-ra-classic/gateway/healthcheck.mjs \
  games/book-of-ra-classic/gateway/entry.html \
  games/book-of-ra-classic/gateway/recovery-client.js \
  games/book-of-ra-classic/gateway/preview-font-ready.js \
  ./
USER app
ENV BOOK_CLASSIC_GATEWAY_PORT=8791 \
    BOOK_CLASSIC_BIND_HOST=0.0.0.0 \
    BOOK_CLASSIC_GATEWAY_HOST=127.0.0.1
EXPOSE 8791
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD ["node", "healthcheck.mjs"]
CMD ["node", "server.mjs"]
