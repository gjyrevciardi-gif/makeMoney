# Lucky Lady platform integration contract

## Baselines and ownership

Root: Astra. One implementation worker: native DeepSeek V4.1 Flash, no recursive delegation.
Implementation target: `C:/Users/Admin/Desktop/toto`, clean `integration/game-workspaces`
at `74c841a`. This is the main project integration worktree. Do not merge, push, deploy, or
touch the frozen `toto-buyer-demo`, Book, Gates, or their branches. Current user authorization
supersedes the older CURRENT_TASK restriction on starting another game.

Read-only game source: `C:/Users/Admin/orca/workspaces/toto/lucky-lady-runtime`, commit
`6e11d04`. Preserve that worktree, including unrelated untracked research. Copy only necessary
first-party clean math/runtime/bridge files from that commit into the integration workspace;
do not import recovered third-party assets into Git. Accepted engine, rules and frozen profile
must remain byte-identical. Profile canonical hash:
`eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f`.
No RTP calibration. Original client is the external 185-file LuckyLadysCharmDX cache.

## Platform and trust boundary

Existing platform is Nest/Prisma/PostgreSQL, Next frontend, integer-PTS Wallet and append-only
LedgerEntry. CasinoRound, CasinoRoundAction and CasinoTransaction already exist. Reuse these
tables/conventions; no authoritative SQLite wallet and no parallel Lucky Lady economic ledger.
Add narrowly scoped session/launch persistence and additive optional ledger metadata if needed.
Do not weaken existing AccessGuard/RolesGuard or generic permission checks.

Launch issuance uses verified platform access authentication and current database USER role
(ADMIN is not a player for this endpoint), enabled/config/maintenance checks, rate limits and
strict input validation. Browser supplies no ownership identifiers. Generate at least 256 bits
of random opaque launch capability, store only hash, Lucky Lady scope, actor, expiry (60 seconds),
and atomic consumption state. Exchange exactly once for a separately random hashed game session
capability, bound to user/game/session and bounded expiry. Recheck user role and session/game
authorization on gameplay; prohibit cross-user round/action/session access. A fresh authenticated
launch after expiry can reconnect to the same user's existing round without creating another.

Third-party scripts must not share an origin/cookie authority with the platform authenticated
application. Use a narrow loopback game gateway/static host on a separate configured hostname
from the platform (local platform localhost, game 127.0.0.1 is sufficient). The launcher may
POST the one-time token to a new top-level game tab to avoid third-party-cookie restrictions.
Do not put the platform JWT, refresh token, or credentials into HTML, URL, localStorage or game
messages. No token in URL/referrer/logs. Exchange POST sets HttpOnly game-only cookie and redirects
to a clean URL. Gateway forwards ONLY this game's protocol to its platform controller, not generic
API routes; no privileged gateway credential needed when opaque game capability is validated by
the platform. Validate Host/Origin, narrow routes/path containment, CSP, no external requests,
no-store, body bounds. Production cookies Secure; documented loopback HTTP exception only.
Do not weaken global platform CORS/security for the recovered client.

## Money and native protocol

Fool's Gold uses whole PTS, not hundredths. Use one clean-math integer unit = one PTS. Offer
native per-line stakes 1/2/5/10/20 PTS at the validated 10 lines (10/20/50/100/200 PTS total).
This is unit/denomination adaptation in settings/protocol, not a paytable/profile change. Never
round fractional platform money. Use BigInt for persistence/arithmetic; check safe conversion
limits at the legacy Number protocol boundary. Registry min/max reflect this mapping.

getSettings and recovery balance are the actual platform Wallet.balance, with zero welcome
credits. Test funding uses the existing audited admin-grant path in a disposable test database.
Game math/state owns pending winnings. Unlike the disposable pilot's early-credit bookkeeping,
platform winnings remain pending until collect (or the native terminal settlement action).
Only then append one CASINO_WIN and atomically credit Wallet. Gamble win doubles pending win;
loss sets it to zero and closes without a credit or a second original-stake debit. Free spins
accumulate pending win without a wager debit. The bridge may adapt native counter/protocol
presentation to these authoritative balances; do not edit recovered bundles/assets or disguise
pending winnings as spendable platform balance. Trace the native START/collect lifecycle so a
new paid round cannot discard pending winnings. Account for the whole feature exactly once.

Every debit/credit must use the existing platform ledger convention in the same PostgreSQL
transaction as wallet and game-state change. Extend an existing transaction-aware wallet helper
or add one using that convention; no separate ledger. Persist user/game/session/round/action,
signed integer amount, before/after balance, timestamp and unique economic key (additive optional
LedgerEntry fields may supply missing metadata). Existing database append-only constraints remain.

## Outcome durability, concurrency and recovery

Reuse the exact accepted clean engine/profile/CSPRNG. Adapt the accepted protocol/state transitions
to platform persistence rather than maintain a second money database or invent game mechanics.
Use explicit database locking, ownership-qualified reads, canonical semantics, durable response
caching and idempotency constraints. Identical concurrent requests serialize before RNG and debit;
recheck stored response after acquiring lock. Lock scope must cover the same user/game across
multiple launch sessions and protect wallet updates from concurrent platform spending.

Prefer atomic PostgreSQL wallet+ledger+round+response settlement. Preserve the accepted durable
prepared-outcome journal where needed: save a generated authoritative result/round identity in
platform private state before economic settlement, then settle that SAME result atomically.
Check authorization, enabled game, wager and sufficient wallet before drawing. An economic
transaction failure must leave no debit and retain any already-durable prepared result; no reroll
on financial/serialization failure. Never expose a result before durable commit. A crash before
any preparation commit is not an accepted round. No remote-wallet dual writes or compensation
unless a documented unavoidable boundary exists. If all writes roll back, no refund ledger row
is necessary; committed outcomes with a lost HTTP response replay unchanged.

Pin profile id/hash/version per new paid round. Future feature boards stay server-private.
Replay returns original response, even after ACK; different canonical semantics with same key
conflict. Scope action keys and queries to the authenticated owner/game. Recovery reads do not
advance counters or settle winnings. Preserve prepared/delivered/ACK distinction; transmission
is not acknowledgement. Same pre-ACK board resumes; valid browser receipt gates next mutation.
Timeout withholding fix and no-reload-loop behavior from 6e11d04 must survive the platform bridge.

## Implementation bundle and validation

One worker owns platform module/controller/service, minimal registry/config/module/schema/migration
additions, launcher page and narrow gateway, accepted game-code copy/adaptation, tests and report.
Allowed shared changes only as required by this game. Do not modify other game implementation,
auth algorithms, sportsbook, unrelated wallet operations, shared RTP profiles or buyer demo.
Avoid new dependencies where installed platform tools suffice. Apply migrations ONLY to an
explicit disposable *_test database on a dedicated local port, never ambient .env development DB.
Docker compose test definition exists, but Docker daemon was unavailable during planning; worker
may start the installed trusted Docker Desktop hidden or use an existing safe local test service.
Do not claim mocked persistence tests prove PostgreSQL concurrency/ledger behavior.

Tests must cover login as normal USER, zero initial wallet, authorized grant, role denial, expired
and reused launch tokens, game scope, original client boot, settings balance, one paid debit and
15/15 stable visible board, pending win then one collect credit, zero-balance no-RNG/no-round,
identical/conflicting/concurrent replays (execution/RNG/debit counts), free spins/no extra debit,
15->30->30 retrigger, gamble win/loss and duplicate actions, refresh before/after ACK, active bonus
recovery, ownership spoofing and cross-user IDOR (use second normal user), rollback after injected
failure, and immutable ledger sum == wallet delta. Real Postgres integration and bounded original
browser evidence required. Tests inject deterministic RNG only through test DI, unreachable from
production HTTP/env controls. Preserve 185 client hashes and exact frozen math identity. No large
simulations. Run relevant existing platform auth/casino/wallet tests and typechecks as applicable.

Create `docs/agent-work/lucky-lady-runtime/FOOLS-GOLD-INTEGRATION.md` with user-requested sections,
commands, concrete evidence and limitations. No false PASS for blocked tests. At a real blocker,
save a concise checkpoint with changed files and exact remaining dependency; do not widen scope.
Worker returns ready-for-review without committing. Astra reviews actual diff and evidence once,
at most one consolidated small correction, then commits only accepted integration:
`feat: integrate Lucky Lady with Fool's Gold`. No merge or deployment.
