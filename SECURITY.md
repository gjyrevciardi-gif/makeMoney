# Security operations

- Refresh tokens are random 384-bit values. Only SHA-256 hashes are stored in `RefreshToken`; raw values exist only in the `HttpOnly; Secure; SameSite=Strict; Path=/auth` cookie.
- Access tokens expire after 15 minutes. Refresh-token rotation preserves a family ID; reuse of a revoked token revokes every currently active token in that family.
- Protected requests resolve the current user and role from PostgreSQL after JWT verification. Admin point mutations perform an additional database-role check in the service.
- `AuditLog` and `LedgerEntry` reject `UPDATE` and `DELETE` through database triggers. Production should additionally grant the application database role only `SELECT` and `INSERT` on `AuditLog`, reserving migration ownership for a separate role.
- Login, registration, refresh, betting, and admin mutation limits use Redis. Limits are centralized in `backend/src/common/rate-limit.service.ts`.
- Provider clients should use `RedisService.cached()` with a stable provider/resource key and bounded TTL. It coalesces concurrent same-process cache misses; a distributed lock can be added if deployment expands beyond one API process.
- Production uses explicit `CORS_ORIGINS`, secure refresh cookies, non-public
  database/Redis services, and `REGISTRATION_ENABLED=false` after bootstrap.
- Use the read-only integrity checker after restores and before serving a
  restored database.
