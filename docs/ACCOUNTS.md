# Accounts, roles and the password vault

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
| `POST /admin/users` | Create an account `{ username, password?, role? }`. Omit the password to have one generated (returned once). Only a SUPER_ADMIN may pass `role: "ADMIN"`. |
| `POST /admin/users/:id/password` | Set or reset a password. Revokes the user's refresh tokens. |
| `POST /admin/users/:id/password/reveal` | Read the current password back. Audited on every call. `no-store`. |
| `POST /admin/users/:id/username` | Change a username. |

An out-of-reach target (for example an ADMIN naming a SUPER_ADMIN) is answered as 404, so ids cannot be probed.
All of these share the admin rate limit.

## The password vault (admins can see passwords)

Login verifies the **argon2 hash** only. A second copy of the password is stored **encrypted** in
`UserPasswordVault` purely so an ADMIN or SUPER_ADMIN can read it back.

- AES-256-GCM, a fresh random IV on every write, and the owning user id bound in as authenticated data, so a
  ciphertext moved onto another user's row fails to decrypt.
- The key is `PASSWORD_VAULT_KEY` (32 random bytes, base64) in the **server environment**: never in the
  database or the repo. A database dump or backup contains only ciphertext.
- Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- **Back the key up separately from the database backups.** If it is lost, stored passwords cannot be shown
  (users can still log in; an administrator sets new passwords).
- Production refuses to start without a valid key. If the key is missing or malformed at runtime, create and
  set-password fail with 503 and change nothing.
- **Rotation:** set a new `PASSWORD_VAULT_KEY` and `PASSWORD_VAULT_KEY_ID`, and put the old one in
  `PASSWORD_VAULT_PREVIOUS_KEYS` (JSON `{"<oldKeyId>": "<base64>"}`). Rows are re-encrypted with the new key
  whenever a password is set. Remove the old key only once no row uses it.
- **Residual risk:** anyone who obtains both the key and the database can read every password. Protect the key
  like a root credential. Because an administrator can see a password, a login with it cannot prove who
  acted; the audit log records every reveal (who, which user, when) but never the password itself.
- Passwords set before the vault existed (including the first super admin) were only ever hashed, so they cannot
  be shown. They become viewable the next time the password is set.

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
- The TOTP secret is stored encrypted with the same `PASSWORD_VAULT_KEY` as the vault.
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
