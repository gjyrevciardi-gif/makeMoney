# Milestone A1: reversible password storage removed

Backend security change. Scope: the platform NestJS API. It closes the reversible password path end to end:
no writes, no read-back endpoint, and the historical ciphertext rows are purged by a data-only migration. All
handler code lives under `backend/`.

This document is the operator-facing record for that change: what moved, the exact migration, the deployment
order, and what is deliberately left alone for a reviewer.

## What changed

- `UserAccountsService` (create / administrator reset / own change) persists **only** the Argon2id hash on
  `User.passwordHash`. It no longer injects the cipher service, so account operations work without
  `PASSWORD_VAULT_KEY` when MFA is not in use.
- `POST /admin/users/:userId/password/reveal` and `UserAccountsService.revealPassword()` are **deleted**. The
  route is unmapped, so it answers `404` for every role, authenticated or not, and no service method remains to
  call.
- A server-generated password is still returned exactly once, in the `POST /admin/users` response
  (`generatedPassword`). A supplied password is never echoed. No password or ciphertext is written to
  `AuditLog`, `SecurityEvent`, or the retired vault table.
- `PasswordVaultService` (`backend/src/auth/password-vault.service.ts`) is retained unchanged in behaviour, but
  its only remaining caller is `MfaService`, which seals TOTP secrets. The class name and the
  `PASSWORD_VAULT_KEY` / `PASSWORD_VAULT_KEY_ID` / `PASSWORD_VAULT_PREVIOUS_KEYS` environment variable names are
  kept so existing TOTP rows keep decrypting with the same keys.
- `UserPasswordVault` and its Prisma model are retained but retired, so the purge stays data-only instead of a
  destructive schema rebuild.

## Migration

New migration: `backend/prisma/migrations/20261012130000_retire_password_vault/migration.sql`. The entire
executable body is:

```sql
DELETE FROM "UserPasswordVault";
```

Characteristics, in the terms a reviewer should check:

- Targets only `UserPasswordVault`. There is no `DROP`, no `TRUNCATE`, no `ALTER TABLE`, and no statement
  touching `User`, `Wallet`, `AuditLog`, `RefreshToken`, `SecurityEvent`, `UserTotp`, `UserRecoveryCode` or any
  other table.
- Does not modify or re-hash `User.passwordHash`, does not touch `authVersion` or `disabled`, and does not
  re-encrypt or rotate any MFA secret.
- Idempotent and irreversible in the intended way: re-running it is a no-op, and the deleted ciphertext rows are
  gone. It is a purge, not an archive.
- Validation (`backend/test/password-vault-purge.integration.spec.ts`) executes this exact file against a real
  PostgreSQL test database with a seeded vault row and asserts the row is gone while the user id, hash,
  `authVersion` and `UserTotp` row are unchanged; it also asserts the file contains no destructive statement
  and can run twice.

## Deployment order (required)

The purge is only safe once nothing can write password ciphertext back:

1. Deploy the A1 application build (writes removed, reveal route gone) to **every** backend instance. Drain the
   superseded instances: stop routing to each pre-A1 node and let that node's in-flight requests finish before
   it exits, so no request that started under the old binary can still be mid-write. This is a drain of the
   old writers, not a blanket drain of the new build.
2. Confirm every live backend instance is running **A1-or-later**, that **no** pre-A1 writer is still serving,
   and that no old in-flight request is still holding a write. A rolling deploy that leaves an old node running
   can re-create a `UserPasswordVault` row for any account it touches after the purge. Also confirm no external
   caller of `POST /admin/users/:id/password/reveal` remains.
3. Only then run `prisma migrate deploy` (or the reviewed equivalent) so `20261012130000_retire_password_vault`
   applies.
4. Verify `SELECT count(*) FROM "UserPasswordVault";` returns `0`.

Rollback: the purge is irreversible by design. Rolling the application back to a pre-A1 build would make the
reveal endpoint live again but would find no rows and would start re-writing ciphertext on the next password
operation, so treat a rollback as a new decision, not a data restore. Do **not** restore an old database
snapshot to "get the passwords back"; that would resurrect the reversible copies this milestone removed and
would also revert unrelated data. If a restore is genuinely required for an unrelated reason, the
`UserPasswordVault` rows may come back with the snapshot. Inspect the restored `_prisma_migrations` table:
if this migration is already recorded as applied, `prisma migrate deploy` will **not** replay it. If it is
pending, apply it under the same writers-stopped procedure as steps 1-2 above. If it is already applied but
vault rows remain, use that same writers-stopped procedure and run the reviewed targeted
`DELETE FROM "UserPasswordVault";` by hand, then verify `SELECT count(*) FROM "UserPasswordVault";` is `0`
before sending traffic. Do not leave the restored rows in place, and do not skip the writer stop just because
the migration table says the change is applied.

## Backups, replicas and other historical copies

The purge removes rows from the live database only. It does not, and cannot, remove the data from anything that
copied it earlier.

- The real backup inventory of any deployed environment has **not** been verified from this worktree. The
  statements below describe the repository's documented procedure and the required handling; they are not a
  claim that any specific snapshot was found, purged, or expired. No backup, dump, archive, WAL segment, replica
  or log file was read, copied, moved or deleted while making this change.
- Relevant repository documents, read for this note only: `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`
  ("Backups and restore"), `docs/VPS-DEPLOYMENT.md` (section 5), `docs/SECURITY.md` ("Compromised backups"),
  and `scripts/backup-postgres.sh`. The script writes compressed `*.dump.gz` files under `BACKUP_DIR`
  (default `./backups`, git-ignored) with `BACKUP_RETENTION_DAYS` (default 14) retention and expects encrypted
  off-host copies.
- Every pre-A1 logical dump, physical snapshot, WAL/archive segment, streaming-replica copy, and any log line
  that captured the old ciphertext (or, worse, plaintext) is a historical copy of reversible password material.
  Operators should inventory these stores per environment, restrict read access to them as they would any
  credential store, place them under the shortest retention the legal hold allows, and destroy them with a
  documented secure-expiry/disposal step at the end of that window. Off-host copies need the same treatment as
  the local ones. The `PASSWORD_VAULT_KEY` remains part of that risk picture, because a snapshot plus the key
  still decrypts the old rows even though the live rows are gone.
- Legal hold or incident-preservation requirements override ordinary retention. Where a hold applies, keep the
  copy under access restriction rather than deleting it, record who approved the hold, and revisit at expiry.
- Do not delete the last known-good backup as part of this milestone. `docs/OPERATIONS.md` treats a
  zero-byte/missing backup as a failed backup and requires a verified restore into a disposable database before
  the old backup is discarded, which the A1 change does not alter.

## Shared MFA key (explicitly out of scope)

`PASSWORD_VAULT_KEY` must not be destroyed or rotated away as part of A1. It still decrypts every administrator
TOTP secret in `UserTotp`. Destroying it locks every enrolled administrator out of two-factor, and previous-key
handling exists precisely so rotation does not strand existing rows. Re-encrypting TOTP secrets under a new key
is a separate, reversible-verification procedure with its own migration; it is not part of this milestone.

## Frontend handoff (owner: Classic frontend / gateway workstream)

The API no longer serves this flow, so the admin UI has dead controls. These edits are **not** part of this
backend change and were not made here:

- `frontend/app/admin/users/page.tsx`: remove the `revealPassword()` handler (calls
  `POST /admin/users/:id/password/reveal`), the "Show password" button, and the `revealed` state plus its alert
  block. The reveal call would now receive a 404.
- Same file, the create result text currently reads "You can show it again later from the user panel."; the
  generated password can only be shown once, so that sentence must go.
- The generated-password display itself stays: `POST /admin/users` still returns `generatedPassword` once for a
  server-generated account.
- `frontend/lib/admin.ts`: the `PASSWORD_NOT_AVAILABLE` and `PASSWORD_VAULT_NOT_CONFIGURED` message entries have
  no reachable trigger from the account creation flow after this change; they can be removed when the button
  is.

## Not changed

- Gameplay, math, wallet/ledger, sports, session revocation (`authVersion`), Deluxe, Sweet Bonanza, launcher,
  E2E and Docker gateway. PR17's `authVersion` increment, refresh revocation and proof-CAS behaviour are
  preserved.
- Authorization and ownership rules, disabled-account checks, and the ADMIN vs SUPER_ADMIN target rules are
  untouched.
- Deployment configuration (`docker-compose*.yml`, `.env*.example`) and the frontend are owned by other
  workstreams and were left alone.
