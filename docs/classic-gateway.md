# Book of Ra Classic gateway

The gateway is a separate origin from the platform. It exchanges a one-time launch capability for an HttpOnly cookie and forwards only `/game/BookOfRaCL/server`. It does not hold a platform JWT.

## Compose

- `docker-compose.yml` publishes the gateway on `127.0.0.1:8791` only and bind-mounts the cabinet for a private local run.
- `docker-compose.prod.yml` places the gateway on the `edge` network. It has no host port. Caddy publishes `classic.${DOMAIN}` and is still the only public listener. The gateway calls `http://backend:3001`. Game, launcher and platform hostnames stay different.
- `docker-compose.classic-b1.yml` is an isolated smoke stack (`fools-gold-classic-b1`) on its own database, Redis and loopback ports. It is not a production deployment.

`BOOK_CLASSIC_BIND_HOST` is the listen address inside the container (`0.0.0.0`). It is not accepted as a request `Host`. `BOOK_CLASSIC_ALLOW_REMOTE=true` is set only where the platform hostname is a Compose service name or a public DNS name. The gateway still refuses a shared hostname between the game origin, the platform and the launcher.

## Release blocker: recovered cabinet

The files under `games/book-of-ra-classic/client` are a recovered commercial cabinet. They are excluded from the Docker build context and are not copied into `games/book-of-ra-classic/gateway/Dockerfile`.

Production Compose does not mount that directory. `BOOK_CLASSIC_CLIENT_DIR` is empty unless an operator sets it. Do not set it, and do not publish the cabinet, until the right to distribute those assets is confirmed. An empty directory makes `/healthz` report `client: false` and cabinet URLs return 503. That is intentional.

A private loopback smoke test may bind-mount the directory. That mount is not a license to deploy it.
