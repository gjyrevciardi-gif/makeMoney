# Security operations

## Secrets and environments

Never commit `.env`, `.env.production`, provider keys, database passwords, JWT
secrets, TLS private keys, or backup files. Documentation uses placeholders
only; real secrets belong in the VPS secret-management process.
Production startup rejects missing, placeholder, duplicated, or insecure
secrets and requires HTTPS CORS origins, secure cookies, and trusted proxy
settings.

PostgreSQL and Redis are internal-only. Only Caddy publishes ports 80 and
443. The firewall must not publish PostgreSQL 5432 or Redis 6379.

## JWT secret rotation

Generate new random access and refresh secrets independently. Deploy the
reviewed configuration during a maintenance window. Existing access tokens
will fail after access-secret rotation; refresh-token families should be
revoked as part of the rotation and users asked to sign in again. Never print
old or new secrets in logs, tickets, shell history, or documentation.

## Provider API key rotation

Create a replacement provider key, update the backend-only secret, restart the
backend, verify provider status, then revoke the old key. Provider keys must
never be sent to browser code, committed to Git, or used in CI/smoke tests.

## Sessions and Admin access

To revoke sessions, use the authenticated logout/revocation flow or the
reviewed operational database procedure; do not edit token hashes casually.
When demoting an Admin, revoke active sessions and verify that old access
tokens no longer reach Admin routes. Review `PERMISSION_DENIED`,
`REFRESH_REUSE_DETECTED`, bootstrap, grant/remove, and settlement audit events.
Keep an immutable export or protected copy of audit evidence according to the
operator retention policy.

## Database and Redis credentials

Rotate PostgreSQL and Redis credentials by creating replacement credentials,
updating the private production environment, validating connectivity and
readiness, then revoking the old credentials. URL-encode reserved characters
in connection URLs. Do not expose either service publicly during rotation.

## Compromised backups

Treat a suspected backup exposure as a credential and data incident. Restrict
access to the backup store, preserve evidence, rotate database/Redis/JWT and
provider credentials as appropriate, revoke sessions, and assess whether
personal or operational data was exposed. Do not overwrite evidence or upload
the backup to a public issue. Restore only into an access-controlled,
disposable environment while investigating.

## Authentication, authorization, and outcomes

Access tokens are short-lived. Refresh tokens are rotated, stored only as
hashes, and revoked on reuse. Admin routes require a persisted `ADMIN` role;
an old token does not preserve access after demotion. Casino outcomes,
sportsbook odds, settlements, wallet balances, and payouts are
backend-authoritative. Client-provided identity, balances, outcomes, or
payouts are rejected. Ledger mutations use transactions and idempotency keys.
Do not add manual outcome controls or player-specific RTP.

## Logging and review

Use request IDs from response headers to correlate structured logs. Logs must
not contain passwords, cookies, JWTs, refresh tokens, provider keys, or casino
private state. Review dependency advisories with
`npm audit --omit=dev`; do not use forced major-version upgrades without a
separate compatibility and security review.
