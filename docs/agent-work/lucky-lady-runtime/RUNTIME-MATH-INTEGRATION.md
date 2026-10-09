# Lucky Lady clean runtime integration — accepted closure

All five bounded closure items pass final Astra acceptance after one review and one small ACK
timeout correction. Commit: `fix: complete Lucky Lady clean runtime integration`.
Port 8766 remains stopped. No merge, deployment or Fool's Gold integration.

The preserved candidate was continued. Changes consist of the external recovery bridge
(`harness/recovery-client.js`), isolated `runtime/` implementation, tests, evidence and this
report. `math/engine.mjs`, `math/data/rules.json` and the frozen RTP50 profile are byte-identical
to `5beffea`. The unrelated untracked `RTP-RNG-PLAN.md` / `RTP-RNG-REMEDIATION.md` are preserved.

## 1. Browser receipt (ACK) hook

The server now persists an authoritative action identity per delivered result and a receipt state
next to it (`responses.event`, `responses.acked_at`; the existing `acks` table stays as the
journalled record). Every recovery snapshot exposes `actionId` plus
`receipt: { event, delivered, acked }`; `delivered` is set from `res.end`, which remains a
transmission **attempt**, never proof of presentation.

The new presentation gate in `handle()` sits after request replay and before any mutation
handler. Until the latest action is acknowledged, the next gameplay mutation
(`bet`, `freespin`, `slotGamble`, `recoveryGamble`, `recoveryCollect`) is refused with
`409 { code: 'ACK_REQUIRED', reason: 'previous action not acknowledged' }`. Reads
(`getSettings`, `update`), exact replays under the original request id, and repeated receipts stay
harmless. An acknowledgement must name the exact action: an unknown id is refused, and a stale id
for an older action cannot release a newer pending result.

Financial settlement is untouched and remains a separate axis: the wager, paid win, feature win
and gamble win/loss are durable inside one SQLite transaction, and an acknowledgement moves no
money, advances no feature and draws no RNG.

`harness/recovery-client.js` carries the receipt hook. After `ResponseController(response)` — or
after `restore()` has filled the reels from the authoritative snapshot — the bridge waits until
the on-screen reels actually show the authoritative rows for that result **and stay settled**
(two consecutive stable observations, because the reels bounce for a few frames after they first
land; responses without a board, such as a gamble dealer card, are already painted
synchronously), then posts
`{ slotEvent: 'ack', actionId }`. The gate keeps the next gameplay action blocked until that
receipt is accepted; a rejected or stale receipt reconciles through a reload instead of a new bet.
A snapshot without `actionId` (older PHP protocol) leaves the bridge inert rather than guessing.

The render wait is authoritative for the receipt: `waitForBoard` requires two consecutive settled
observations and returns `false` on timeout, and a timeout is **never** satisfied by a single final
observation. A `false` is honoured, not ignored — no acknowledgement is sent, the withheld receipt
is recorded (`window.pilotReceipts` entry with `accepted: false`, `reason: RENDER_TIMEOUT`, plus
`window.pilotReceiptWithheld`), and the server keeps that action pending and recoverable. The
reconciliation reload is limited to once per action id (a session-scoped marker), so a permanently
unrenderable result cannot reload the page forever, and the receipt promise always settles
`true`/`false` so a withheld receipt cannot surface as an unhandled rejection.

Focused stalled-rendering regression (`browser-regression.cjs`; the shared round is reset to
`IDLE` first, so the stalled action is a real paid bet, then the presentation is stubbed and the
page clock scaled so the 20 s wait is exercised in bounded time):

| Measure | Result |
|---|---|
| ACK sent while the board never rendered | **0** |
| Withheld receipt | recorded `RENDER_TIMEOUT`; no unhandled rejection, reloaded at most once |
| Server state for that action | `{ event: 'bet', delivered: true, acked: false }` — still pending |
| Next gameplay action | `409 previous action not acknowledged` |
| Ledger for the one accepted action | `bet -100`, `paid-win +500` (its own rows only) |
| Extra draw/debit beyond that action | none (`actionExecutions +1`, `outcomeGenerations +1`, `engineRngDraws +80`) |
| After a refresh | the same action is rendered and acknowledged (`acked: true`), rendered board equals the authoritative board, no further draw or debit |

## 2. Two simultaneous identical HTTP requests

`probes.concurrent` — one request id, one player, canonical body, fired exactly twice in parallel:

| Measure | Result |
|---|---|
| HTTP statuses | `200` / `200` |
| Response bytes | identical original JSON |
| `bet` ledger debits | exactly 1 |
| Accepted action executions (test-only counter) | exactly 1 |
| Complete outcome-generation RNG invocations | exactly 1 |
| Engine RNG samples inside that one generation | 80 |

One *complete outcome generation* is one `playRound` execution, not one random integer: the
evaluator samples five reels plus one five-reel sample per free spin of the captured feature
sequence. `math/test-vectors.mjs` independently reports `draws: 80` for the 15-spin vector and
`draws: 155` for the 30-spin vector, which is exactly what the counters recorded here.

## 3. Credit proof

`probes.credit` — deterministic winning paid result (native 0.10 x 10 lines), then a gamble win,
then collect:

| Step | Ledger | Balance |
|---|---|---|
| Paid spin settles | one `bet` `-100`, one `paid-win` `+300` | `1,000,000 -> 1,000,200` cents |
| Collect (once) | unchanged (3 rows) | unchanged |
| Collect exact replay | unchanged (3 rows) | unchanged |
| Gamble win | one `gamble-win` `+300` | `+300` exactly once |
| Gamble exact replay | unchanged | unchanged |

Ledger deltas are integer minor units; the protocol's `Balance` / `afterBalance` / `totalWin` are
the native currency rendering of the same cents (`balanceCents === round(recovery.balance * 100)`).
The win is credited when the paid result settles. The wallet collect is a presentation
acknowledgement and adds **zero** credits; its replay returns the original settlement unchanged.
The previous tautological "no duplicate feature credits" assertion is gone.

## 4. Retrigger through the real HTTP route

`probes.retrigger` — `createDeterministicRng('rt-search-138824')` through `slotEvent: 'freespin'`
on the normal `/game/LuckyLadysCharmDX/server` route, with one receipt per action:

| Measure | Result |
|---|---|
| Trigger | paid spin awards 15 free games |
| Retrigger | exactly one `15 -> 30` |
| Feature consumption | exactly 30 free spins |
| Replay of the retrigger request | `200`, byte-identical JSON, same profile and round |
| Ledger / counters across that replay | unchanged (no draw, no debit, no execution) |
| Live free counter across that replay | unchanged, total stays 30 |
| Execution counters | `actionExecutions 31` (1 bet + 30 free spins), `outcomeGenerations 1`, `engineRngDraws 155` |

## 5. Gamble win and loss

Win is asserted in section 3 (`gamble-win`, stake `+300` credited exactly once). Loss uses a
bounded injected gamble seed that draws the opposite colour on purpose:

| Measure | Result |
|---|---|
| Injected seed | `gamble-lose-2`, dealer card `S` against a red choice |
| Pending win before | `+300` (already credited at spin) |
| After the loss | `pendingWin 0`, phase `IDLE`, exactly one `gamble-loss` `-300` |
| Balance | `1,000,200 -> 999,900` cents, i.e. the accepted stake only |
| Identical replay | same JSON, ledger and gamble-RNG counters unchanged |
| Refresh after loss | `IDLE`, `pendingWin 0`, same round, same balance |

Gamble odds and the red/black double-or-nothing rule are unchanged; the injection only chooses
which legitimate dealer card the unchanged evaluator draws.

## Preserved, previously verified

Prepared-outcome refresh recovery, canonical logical-request replay, conflict rejection, single
debit, exact 15/15 visible board stability, active-free refresh, CSPRNG-only production path and
the frozen RTP50 profile are unchanged and still covered by the suites below. The recovered
original client is byte-identical across the whole run: 185 files, manifest
SHA-256 `85c26131aac4a0444ff33d420ea2060c5d4753a0e4d92e4d6937a6c78ea48a50`, zero outbound
requests, zero page errors.

## Evidence

| Artifact | Result |
|---|---|
| `runtime/runs/runtime-tests.json` | **120 checks, 0 failures** |
| `runtime/runs/browser-regression.json` | **54 checks, 0 failures** (includes the stalled-render probe) |
| `runtime/runs/runtime-static-audit.json` | pass, zero findings, production entry cannot reach test controls |

Commands (all loopback, fresh disposable databases, no installs, nothing activated):

```
node docs/agent-work/lucky-lady-runtime/runtime/test-runtime.mjs
node docs/agent-work/lucky-lady-runtime/runtime/browser-regression.cjs
node docs/agent-work/lucky-lady-runtime/runtime/static-audit.mjs
node docs/agent-work/lucky-lady-runtime/math/test-vectors.mjs
```

Math identity is unchanged and pinned: engine
`0f02bb1e78eafdd99a51015c4bf83848050ca6b6e898123759d1442787d12843`, rules
`4c03dd436f18307d9f98dc2148ff422251faa2d5c1c928062257187883acfc57`, profile file
`14a5f695611aebd33b0f27f7894731b5e0e03934fc2261366598f84a0314bb65`, frozen profile canonical
hash `eb0a22171a3479cea3b0238269edd4b0dc5d9486c57e4b057fa6ee0f1a70be5f`. `runtime-math.mjs`
(`7512B26792A2372C94298FB5096345F690BA1594C770180B0E32EBAD7FA8F17D`) is untouched, so the
retained RTP artifacts remain valid: 4,000,000 paid rounds at **49.9134%** (95% CI
49.5357–50.2912%) and the 100,000-round sanity sample at **50.0075%**. No recalibration, no new
large simulation, gamble excluded from slot RTP.

## Limitations

- This pilot is bounded to the validated 10-line configuration at the native 0.01–0.20 stake
  ladder; other line counts and stakes are rejected before any draw.
- One player-scoped disposable session and one Node server process per database. Concurrent
  HTTP requests are serialized by that process; multi-process deployment is not covered.
- Use a fresh clean-runtime database. Legacy PHP in-flight features are not migrated or
  relabelled with the validated profile; the old database remains separate.
- A rejected, stale or render-timed-out receipt reconciles by reloading the authoritative snapshot
  rather than retrying the action; the tests cover duplicate and stale receipts, disconnect before
  a receipt, reload after a receipt, and a stalled render that must withhold the receipt entirely.
- Recovered PHP/harness sources remain archived and unreachable from the active Node runtime.

## Final disposition

**FINAL ACCEPTANCE: PASS.** The retained runtime suite passes 120 checks; the corrected browser
suite passes 54 checks; the active-path static audit passes with zero findings. The timeout
regression proves no false ACK, a closed server gate, and recovery of the same authoritative
outcome without extra execution or ledger movement. Root reviewed the implementation and
persisted evidence; no math calibration or runtime suite rerun was needed for the bridge-only
correction. Original third-party files remain unchanged. Historical rejected-review probes and
failed RTP-remediation notes are excluded from the acceptance commit.
