# Accounts, roles and passwords

## Model

- **Accounts are created by an administrator.** Public registration is off. `POST /auth/register`
  answers 403 unless `REGISTRATION_ENABLED=true`, which is not the default.
- **Login is by username** (3-32 characters: `a-z 0-9 . _ -`, stored lowercase, unique). Accounts created
  before usernames existed can still log in with their email. `POST /auth/login` takes
  `{ identifier, password }` (`email` is accepted as the legacy name for the same field).
- **Passwords are 8-128 characters.**
- **Roles** (highest first)
  - `SUPER_ADMIN`: everything, including creating administrators and managing any account.
  - `ADMIN`: creates and controls `MANAGER`s and players, creates and removes PTS, and runs RTP/math. Cannot
    create, see or manage other administrators.
  - `MANAGER`: creates and runs their own players, but **creates no points**. They can only move points an
    administrator gave them (see below). No game, RTP or audit access.
  - `USER`: plays only.
- A `SUPER_ADMIN` is not created through the API. Promote an existing administrator with
  `scripts/bootstrap-admin.js` (first admin) and `npm run rbac:bootstrap-super-admin --workspace backend`.

## Endpoints (all require the `USER_MANAGE` capability; ADMIN reaches USERs only)

| Endpoint | Purpose |
|---|---|
| `POST /admin/users` | Create an account `{ username, password?, role? }`. Omit the password to have one generated; it is returned once, in this response, and can never be read back. Only a SUPER_ADMIN may pass `role: "ADMIN"`. |
| `POST /admin/users/:id/password` | Set or reset a password. Revokes the user's refresh tokens. |
| `POST /admin/users/:id/username` | Change a username. |

An out-of-reach target (for example an ADMIN naming a SUPER_ADMIN) is answered as 404, so ids cannot be probed.
All of these share the admin rate limit.

`POST /admin/users/:id/password/reveal` was **removed** (milestone A1). The route is unmapped, so every
request answers 404 for every role, and there is no service method behind it.

## Password storage (hash only)

- A password exists only as an **Argon2id hash** on `User.passwordHash`. Login verifies that hash and nothing
  else. No plaintext and no reversibly encrypted copy is written on create, administrator reset, or own change.
- The `UserPasswordVault` table is **retired**. No code path reads or writes it, migration
  `20261012130000_retire_password_vault` purges the historical rows (data only, no `DROP TABLE`), and the empty
  table plus its Prisma model are kept so a future schema rebuild cannot silently drop unrelated data.
- A server-generated password (create with no `password`) is returned **once**, in the create response. After
  that it is not recoverable by anyone, including a SUPER_ADMIN. Losing it means setting a new one.
- `PASSWORD_VAULT_KEY` / `PASSWORD_VAULT_KEY_ID` / `PASSWORD_VAULT_PREVIOUS_KEYS` are **still required**, but
  only because administrator TOTP secrets are sealed with the same server cipher (see the MFA section). They no
  longer protect any password. Production still refuses to start without a valid key.
- Deployment order, backup handling and the residual risk that historical database snapshots still contain the
  old ciphertext are in `docs/SECURITY-PASSWORD-STORAGE-A1.md`.

## Managers and point transfers

- An administrator creates a manager (People and PTS, Role: Manager) and gives them PTS with the normal
  "Grant points" action. That is the only way a manager's balance grows.
- A manager moves points with **Give from my balance** (manager to player) and **Take back to my balance**
  (player to manager), each with a required reference note. `POST /admin/users/:id/coins/give|take`.
- A transfer writes two ledger entries (`TRANSFER_OUT` and `TRANSFER_IN`) that cancel exactly, in one
  serializable transaction, locking both wallets in a fixed order. The paying wallet can never go negative,
  a retry with the same key does nothing, and a changed replay is refused. The database check keeps point
  creation closed: transfer entries need an actor and the right sign, and `scripts/integrity-check.js` fails if a
  transfer entry has no equal and opposite partner.
- A manager cannot grant or remove points, cannot give to anyone but their own players, cannot create
  managers or administrators, and cannot read the audit log or game tools.
- Reach is a tree: an ADMIN sees and controls the managers they created **and the players of those managers**,
  plus their own players. A MANAGER sees only their own players. A SUPER_ADMIN sees everyone.
- Security alerts for a manager's player go to the manager and to the administrator above them (and the
  super administrator), never to another administrator. Transfers appear as "PTS given by a manager" and
  "PTS taken back by a manager".
- With `ADMIN_MFA_REQUIRED=true`, managers must also turn on Google Authenticator.

## Player ownership (each administrator sees only their own players)

- Every account records who created it (`createdById`). An **ADMIN** can see and manage (PTS, password, rename,
  disable) only the **USER** accounts they created. Another administrator's player, or an account with no
  owner, is invisible to them: reads answer 404, writes are refused and change nothing.
- A **SUPER_ADMIN** sees and manages everyone, and is the only one who can hand a player to another
  administrator: `POST /admin/users/:id/owner { ownerId }` (Admin → Users → Owner).
- Accounts created before ownership existed have no owner. Only a SUPER_ADMIN sees them until assigned.

## Security notifications (`/admin/security`)

A `SecurityEvent` row is written **in the same transaction** as the money movement, so it cannot be skipped:

| Event | When | Severity |
|---|---|---|
| `PTS_GRANTED` | an administrator adds PTS | info |
| `PTS_REMOVED` | an administrator removes PTS | review |
| `BIG_WIN` | one payout of 100 PTS or more | review |
| `HUGE_WIN` | one payout of 200 PTS or more | check now |

Each shows who, which player, the amount, the reference note and the balance afterwards. A SUPER_ADMIN sees all
events; an ADMIN sees those about their own players. "Mark as seen" is per event and audited. Win thresholds
are per single payout (constants in `backend/src/security/security-events.ts`).
There is deliberately **no automatic blocking** of administrators yet.

## Google Authenticator (two-factor for administrators)

- Admin → Google Authenticator: add the setup key in the app, confirm with a code, and save the ten recovery
  codes (shown once; each works once).
- With it on, `POST /auth/login` returns `{ mfaRequired, mfaToken }` instead of a session. The session is only
  issued by `POST /auth/login/2fa` with a valid 6-digit code or an unused recovery code. The challenge token
  lives 5 minutes and is rejected as an access token. A code works once; five wrong tries per minute locks the step.
- The TOTP secret is stored encrypted with `PASSWORD_VAULT_KEY`. That key no longer protects any password; it is
  kept (with its key-id and previous-key handling) so existing TOTP rows keep decrypting.
- `ADMIN_MFA_REQUIRED=true` (default in the production compose file) blocks every admin route until the
  administrator has enrolled. Locally it defaults to off so you cannot lock yourself out while setting up.
- **Lost phone and recovery codes:** a SUPER_ADMIN resets another administrator (`POST /admin/users/:id/mfa/reset`).
  If the only SUPER_ADMIN is locked out, run on the server:
  `RESET_MFA_USER=<username or email> RESET_MFA_CONFIRM=YES npm run rbac:reset-mfa --workspace backend`.
- Players do not use two-factor.

## Not built yet

- A user changing their own password, with an admin notification (the password-change event).
- Removing (archiving) a user, which must keep ledger, rounds and audit history.
- Automatic blocking of an administrator on suspicious PTS activity (deliberately left out for now).
