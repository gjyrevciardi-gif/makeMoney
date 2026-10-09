# LuckyLadysCharmDX authoritative recovery

Scoped follow-up to verified runtime commit `638249d`. This changes only the isolated pilot harness. No production integration, recovered asset changes, or RNG/RTP remediation.

## Recovery contract

The original PHP handlers still determine spins, symbols, wins, gamble outcomes and balance changes. A SQLite `Recovery` record now persists the current round ID, monotonic version, phase, accepted stake/lines, complete last spin response, pending win, free-spin totals/index/remaining/multiplier, gamble attempts/cards, settlement acknowledgement and native session payloads. The existing transaction commits this record, native state, ledger changes and explicit-ID response cache together.

`POST /game/LuckyLadysCharmDX/server` retains native `getSettings`, `bet`, `freespin` and `slotGamble` bodies and response events. Responses add a top-level `recovery` snapshot; `getSettings.serverResponse.lastEvent` contains the original last spin envelope. The recovered client has no working native restoration handler, so a separately served local bridge renders that snapshot through existing client classes and controls.

Two minimal acknowledgement events, `recoveryGamble` and `recoveryCollect`, persist formerly browser-only transitions. They return `recoveryAck` and never generate outcomes or credit money. Native winnings are credited when the PHP outcome resolves; collect acknowledges presentation only.

Every mutation carries `X-Pilot-Request-ID`, `X-Pilot-Version` and `X-Pilot-Round`. Exact request-ID/body replay returns the cached response. A different action using a stale version/round receives HTTP 409 before native logic or test fixtures execute. Reads return fresh snapshots, even with a reused read ID. The bridge retries an uncertain transport request once with exactly the same identity/body/version; a conflict reloads authoritative state.

## Results

| Required state | Evidence and behavior |
|---|---|
| BASE RECOVERY | PASS: completed no-win round restores IDLE, authoritative balance and the exact 15-symbol board. No phantom feature. |
| PENDING WIN | PASS: same round/result/win survives refresh; native collect continues without a new outcome or credit. |
| FREE SPINS | PASS: total 15/current 1/remaining 14, locked 0.01 × 10 lines, native multiplier 3 and feature mode survive refresh. Original Start resumes the next free spin, without paid stake. |
| RETRIGGER | PASS: native fixture produces total 30/current 2/remaining 28; refresh and replay preserve counters and round ID. Continuation advances once to current 3. |
| GAMBLE | PASS: pending stake, attempt count and card history survive refresh; red win, black loss and collect use the same authoritative pending state. Original gamble overlay, stake and card history are visibly restored. |
| COLLECT | PASS: ordinary and gamble collect leave the ledger unchanged; subsequent refresh is IDLE with zero pending win. |
| IDEMPOTENCY | PASS: duplicate read, paid bet, collect, gamble and retrigger requests do not duplicate debit, credit or feature progression. Stale-version requests are rejected. |

## Changes

CLIENT CHANGES: `recovery-client.js` is injected into the generated external preview entry. It restores original reel textures, counters, original bonus/gamble views and buttons, disables stale autoplay on reconnect, and waits for Start before another free spin. It intercepts the two formerly local acknowledgement actions and adds request identity/version headers. Recovered client bundles and all 185 files remain byte-for-byte unchanged. No replacement artwork, layout or game math.

BACKEND CHANGES: `recovery.php` owns durable phase/presentation metadata and guards transitions. `router.php` attaches recovery snapshots and handles acknowledgements within the existing SQLite transaction. Original `Server.php`, `SlotSettings.php`, `GameReel.php`, `reels.txt` and extracted shared game math are unchanged. Expired native session entries are restored from persisted payloads so the source's 24-hour expiry cannot erase an unfinished tracked feature. `compat.php` adds isolated test database names; `start.py --deploy-only` deploys the bridge without starting a second listener.

## Tests and artifacts

Run from this worktree with the already installed PHP/Chrome/Node environment:

```text
python docs/agent-work/lucky-lady-runtime/harness/start.py --deploy-only
python docs/agent-work/lucky-lady-runtime/harness/test_recovery.py
node docs/agent-work/lucky-lady-runtime/harness/browser_recovery.cjs
python docs/agent-work/lucky-lady-runtime/harness/verify.py
```

TESTS: focused HTTP/database regression passes against the real PHP handlers in a fresh disposable SQLite database, including duplicate/stale requests, locked feature stake, unchanged ledger/session on repeated recovery, and expired-session continuation. The browser regression uses original keyboard controls for normal spin, win, collect, gamble and free-spin continuation, with a native backend fixture for bounded retrigger access. It checks authoritative snapshots and ledger before/after reload, and all 15 restored symbol textures against the original response. Test-only fixtures select existing native paths; no production feature rules are changed.

Evidence stays outside Git under `C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/`:

- `evidence/recovery-regression.json`: HTTP/database results and isolated DB path.
- `evidence/recovery-browser.json`: browser state assertions, errors/network record and DB path.
- `screenshots/recovery-*.png`: 1440×900 base, pending win, post-collect, gamble entry/attempt/collect/loss, free trigger, active free spins and retrigger.
- `evidence/verification.json`: previous compatibility evidence and source-hash verification (185 client blobs plus original backend hashes).

Visual acceptance waits for the original gamble opening tween to reach full world opacity, then two browser animation frames before capture. A visible-container flag alone was insufficient because it becomes true before the overlay fades in. `recovery-gamble-attempt.png` was inspected and shows the original gamble panel, 0.4 USD pending stake, 0.8 USD potential win and the restored red card history. No additional rendering/UI change was required.

The normal pilot remains loopback-only on `127.0.0.1:8766`; automated checks use separate databases on 8767/8768 and stop their listeners afterward. Browser routing blocks non-loopback HTTP and sockets; original CSP and PHP network restrictions remain. No outbound requests were observed in the passing bounded browser run.

## Known limitations

KNOWN LIMITATIONS: this is a single-player disposable local compatibility harness, not a production wallet/session service. Recovery restores the resolved authoritative phase, board and amounts, not an interrupted animation's exact frame. Free-spin recovery intentionally waits for the original Start control; it does not consume a spin merely because the page reloaded. Autoplay preference is not resumed. The most recent retrigger intro may be presented again, but the award/counters are not replayed.

Legacy pre-recovery state did not record browser-only collect/gamble entry, so migration conservatively restores a pending native win when present and cannot reconstruct an unrecorded acknowledgement. The verified guarantees cover rounds tracked by this recovery harness. Browser checks cover desktop; the previously accepted mobile rendering was not redesigned or re-audited. Randomness, Percent/history/bank filtering and their known fairness problems remain unchanged and outside this task.

Flash was assigned the final bounded visual/report task, but ended two turns without delivering changes; root completed the small remaining acceptance/report work without switching providers.

VERDICT: RECOVERY = PASS for the supported states in this isolated pilot, subject to the limitations above.
