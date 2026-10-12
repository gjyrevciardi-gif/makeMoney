# Auth session revocation (authVersion)

Every access token is bound to a per-user counter, `User.authVersion`. The
column starts at `0` for existing rows and is only ever incremented; nothing
compares timestamps, so two events in the same second are still ordered.

## What the pieces do

- `AuthService.createPair` stamps the access token with an `av` claim carrying
  the version in force when the token was minted.
- `AccessGuard` reads the account row, requires `av` to be a non-negative safe
  integer and to equal the stored `authVersion`, and otherwise rejects the
  request as `INVALID_ACCESS_TOKEN`. Missing, malformed, negative, fractional,
  future and stale claims are all refused. Account status and role still come
  from the database, and a disabled account is still refused with
  `ACCOUNT_DISABLED`.
- `POST /auth/logout` is deliberately all-devices for the account that owns the
  presented refresh cookie. An unknown or absent cookie changes nothing. A
  known cookie (even one a rotation already revoked) atomically increments
  `authVersion`, revokes every refresh token for the user, and writes the
  `LOGOUT` audit row.
- `UserAccountsService.setPassword` (administrator reset) and
  `changeOwnPassword` increment `authVersion` in the same transaction as the
  hash update and the refresh revocation, so the caller's own live token dies
  at the same commit as every other device.
- The password step hands its verified snapshot (version plus the argon2 hash
  that was checked) to session issuance, which re-verifies it while the account
  row is locked. A password change or logout landing between the check and
  issuance therefore fails with `SESSION_PROOF_STALE` instead of minting a live
  session from the old proof.
- The MFA challenge token carries the same `av` claim. `readMfaChallenge`
  compares it to the stored version and returns it, and `login/2fa` passes that
  version on to issuance, which re-checks it under the account lock. A password
  change between the challenge and the second step therefore cannot finish a
  fresh session.
- `changeOwnPassword` re-verifies the account with a compare-and-set: the hash
  update and the version increment only apply if the hash, version and disabled
  flag still match what was checked. A concurrent admin reset or logout makes
  the change fail closed instead of overwriting newer state from an old proof.
- `issueTokenPair` mints inside the same locked transaction it reads the version
  in, and refuses a disabled account, so no usable successor token can escape a
  concurrent logout.

Live access JWTs minted before this change carry no `av` claim and are refused.
That is not a forced password reset: a refresh token that is still valid keeps
working and its next rotation returns a versioned access token, so only a
client with no usable refresh token has to sign in again. No `AuthSession`
model is introduced and refresh rotation with family reuse detection is
unchanged.

## Concurrency

Login, refresh rotation, logout and both password-change paths synchronize on
the account row (`SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE`) inside
their existing transaction. Refresh re-reads the token row and the account
version *after* it holds the lock, so:

- a logout that commits first has already revoked the token (and bumped the
  version) and the refresh cannot rotate it;
- a refresh that linearizes first may mint a token, but the logout that follows
  invalidates it immediately, because the guard compares versions and not
  issue times;
- the invalidation and its audit row are committed atomically, and rejecting
  the request happens after the transaction commits, so a refused refresh never
  rolls the revocation back.

There is no retry loop; the loser of a race simply re-reads committed state.
The focused race test parks a refresh and a logout on the same row lock with a
third connection and then releases it, so ordering comes from the lock queue
rather than from a sleep.

## Validation

Focused suite: `backend/test/auth-session-revocation.integration.spec.ts`
(15 tests) against the isolated `security_auth_revocation_test` database on the
dedicated local container. It covers issuance from a stale password proof, MFA
proof binding, the concurrent own-password change, the queued refresh/logout
race, both version-claim shapes and the unchanged rotation/reuse behaviour.

Neighbouring auth suites re-run unchanged: `auth-security`, `mfa`,
`p1-auth-ratelimit-audit`, `hierarchical-rbac`, `user-accounts` (5 suites, 45
tests).

`npm run typecheck` in `backend` passes. Raw run logs are in
`artifacts/auth-session-revocation/`.
