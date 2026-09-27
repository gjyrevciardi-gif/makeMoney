# Lucky Lady local runtime compatibility pilot

VERDICT: **YES_WITH_FIXES.** The recovered client runs end to end with its matching game-specific PHP backend. Real getSettings, one uncontrolled normal spin, five completed reels, the exact server board, and a single wager debit were verified. Feature tests also reached wins, collect, red/black gamble and free spins. This proves local compatibility; native recovery and fairness still require later work.

CLIENT: Unmodified `heidi-luong1109/game` commit `1eb3234892790d0c4ded54233f369aff176d9d8d`, external `frontend-hunt/files/heidi-luong1109--game/public/games/LuckyLadysCharmDX`. All 185 files still match upstream Git blob hashes. The accepted local-font startup entry is reused unchanged; no UI or asset redesign.

BACKEND: Original `Server.php`, `SlotSettings.php`, `GameReel.php`, `reels.txt` from audited taxipult commit `661bc54ddc31ce952c142426d783756c4047a484` execute directly from `external/evidence/taxipult-goldsvet/casino/app/Games/LuckyLadysCharmDX/`. Source hashes are unchanged. No math port or fabricated spin response. Original Banker.php executes directly; four Game methods and User.updateCountBalance are extracted verbatim into external traits. A small compatibility layer supplies SQLite persistence, Eloquent-style access, transactions, one disposable player/session and translations. Tournaments and loyalty progression are inactive in this empty demo shop. No other application services run.

## Runtime and compatibility changes

Open **http://127.0.0.1:8766/**. The original visual-only server on port 8765 is separate. Runtime, portable PHP, generated traits, SQLite, session token, logs and screenshots live outside Git under `C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/`.

Docker was unavailable. Portable PHP 8.3.35 NTS x64 came from the [official PHP downloads](https://www.php.net/downloads.php?os=windows&version=8.3). Its ZIP was verified against the [official releases metadata](https://downloads.php.net/~windows/releases/releases.json): SHA-256 `25a8e2ac9ff30f1d768d1447c09a600617fa6e6082729f6e95f008b59c91fe45`. No installer or imported setup script was run. PHP uses only its SQLite extension; no system PHP configuration was changed.

Fresh player: ID 1, initial balance/count_balance 1000 USD, address 0, active demo session. Fresh shop/game IDs are 1. Configuration comes from source catalog game row 1150 and shop row 1 (including percent 74); histories start at zero and demo slot/bonus banks at 100000 each. No source users, credentials, bank balances or prior sessions were seeded. Jackpot records are empty, so progressive jackpot behavior is not covered. The legacy missing SOUND/list.json branch still returns an empty sound list; audio playback was not repaired.

The harness wraps state changes in one SQLite transaction. It caches responses under explicit `X-Pilot-Request-ID` values and rejects reuse with different request bodies. The observed normal browser request was assigned one such ID by the browser test route. The unchanged native client does **not** itself supply stable retry IDs; replay safety without that local transport aid is not claimed. Original legacy money arithmetic is unchanged, including its float behavior.

From this worktree, with the verified portable PHP directory present:

```text
python docs/agent-work/lucky-lady-runtime/harness/prepare.py
python docs/agent-work/lucky-lady-runtime/harness/start.py
python docs/agent-work/lucky-lady-runtime/harness/verify.py
```

Do not start a second listener while port 8766 is occupied. `state/process.json` records its PID and complete PHP invocation. Preparation extracts only matching configuration and required shared methods. The older `extract_config.py`/`game_config.json` artifacts are unused. The previous Flash quota blocker is superseded by the user's explicit authorization for direct Astra execution. No worker was retried.

## Protocol

All requests are JSON POST to `/game/LuckyLadysCharmDX/server?sessionId=...`; the local harness authenticates its disposable cookie, not that client-generated query value. Successful tested backend replies are HTTP 200 JSON.

| Operation | Actual request | Original backend ? response | Client behavior / result |
| --- | --- | --- | --- |
| Initialize | `{"slotEvent":"getSettings"}` | Server.php:58–62 constructs SlotSettings, serializes it and Lang output ? `responseEvent:getSettings`, `slotLanguage`, `serverResponse` | Original loader initializes settings, fonts/assets, reels and controls |
| Normal spin | `{"slotEvent":"bet","slotBet":"0.01","slotLines":10}` | Server.php:275–667 ? `responseEvent:spin`, `responseType:bet` | ServerConnect consumes result; GameReels.StopReels and GameReel.FillServerReel put returned symbols on all reels |
| Spin fields | Same route | `totalFreeGames`, `currentFreeGames`, `Balance`, `afterBalance`, `totalWin`, `winLines`, `bonusInfo`, `Jackpots`, `reelsSymbols` (`rp`, `reel1`…`reel5`) | Initial/local animation filler does not determine the authoritative outcome |
| Collect | **No server collect request** | Win is already credited by SetBalance in the spin handler | Original Start/Collect button in AFTERWIN invokes AddWin; UI returns to IDLE without another credit |
| Red/black gamble | `{"slotEvent":"slotGamble","gambleChoice":"red"}` or `black` | Server.php:211–273 ? `gambleResult`; `dealerCard`, `gambleState`, `totalWin`, `afterBalance`, `Balance` | Original gamble UI enters, sends choice and presents win/loss |
| Free spin | `{"slotEvent":"freespin","slotBet":"0.01","slotLines":10}` | Same spin handler ? `spin`, `responseType:freespin`; counter increments, no wager debit | First free-spin presentation and response verified in browser |
| Retrigger | A free spin with qualifying scatters | Server.php:648–660 adds native slotFreeCount=15 | API fixture verified 15?30, current free spin 1?2; retrigger animation not independently validated |
| Balance polling | `{"slotEvent":"update"}` | Native handler returns `responseEvent:error`, `responseType:update`, balance string | Original protocol's naming, not an HTTP failure; preserved unchanged |
| Refresh | New getSettings | Current balance and settings returned; lastEvent remains null | Balance persists; previous board/pending-feature UI does not restore |

GETSETTINGS: **PASS, real backend.** Native PHP Server/SlotSettings generate the response. The prior static visual response is not used. The language shim reads the matching source-derived English block preserved by the accepted pilot.

NORMAL SPIN: **PASS.** Exactly one initial unforced normal spin was performed before feature fixtures. Request ID `browser-1790518429685-8`, bet/line 0.01 × 10 lines = 0.10. Result: totalWin 0, Balance/afterBalance 999.90, free count 0. Later paid spins were explicitly marked feature fixtures; no long spin search was run.

BALANCE: **PASS within pilot.** Initial ledger contains exactly one debit: 1000 ? 999.90, delta -0.10. Replaying the identical explicit request ID returned the same spin without adding a ledger entry. The final evidence has 13 reconciled ledger entries across five paid spins, two gambles and three free spins; all free-spin requests have no negative wager entry. Concurrent retry behavior was not separately stress-tested.

REELS / FINAL BOARD: **PASS.** Five stop completions, state IDLE, and all 15 visible PIXI texture IDs match the returned symbols. A second sample after 1.2 seconds was identical. Returned reels, top to bottom:

| Reel 1 | Reel 2 | Reel 3 | Reel 4 | Reel 5 |
| --- | --- | --- | --- | --- |
| P_2 | 10 | P_4 | P_5 | P_1 |
| J | SCAT | A | J | Q |
| P_3 | P_5 | P_1 | P_3 | A |

WIN PRESENTATION: **PASS with test-only win selection.** Original PHP calculated and credited a 0.08 win (999.80 ? 999.88); original UI reached AFTERWIN and showed its win presentation. A separate fixture win provided the gamble stake. No response board/paytable/win amount was fabricated.

COLLECT: **PASS.** Tested the original Start button's collect behavior; no game request and no additional ledger mutation. The source's key-2 mapping mentions uiButtonCollect, but its controller lacks that case; Start/Enter is the operative collect control. No UI fix was made.

GAMBLE: **PASS, original UI and backend with test-only draw selection.** Red returned H/win and doubled 0.30 to 0.60, crediting +0.30. Black then returned H/lose, clearing the stake and debiting -0.60. Backend response and UI remained valid, with no page errors. Gamble refresh/maximum-attempt rules were not exhaustively tested.

FREE SPINS: **PASS for trigger and first spin.** Original trigger awarded 15 and presented “15 FREE GAMES / ALL PRIZES x3”. First free-spin response advanced to 1/15 and credited 1.52 without a wager debit. Original configured free multiplier is 3; line-win calculation applies it while the native scatter calculation is separate. Full uninterrupted animation of all 15/30 rounds was not run.

RETRIGGER: **PASS at backend protocol/state level.** A qualifying native free-spin outcome changed totalFreeGames from 15 to 30. A test-only counter snapshot selected current=29, then the original final-free-spin handler advanced to 30/30. Another free-spin request returned `invalid bonus state`. This is not evidence of a complete visually played 30-spin sequence or final bonus outro.

RECOVERY: **PARTIAL / native gap.** Browser reload after a pending win returned IDLE with the correct credited balance, lastEvent null and a newly filled board. Reload after the first free spin also returned IDLE, despite remaining free-spin counters persisting in the database. The next free-spin API request could continue, but the UI did not resume it automatically. Do not treat persistent balance as complete feature recovery. No recovery redesign was attempted.

## Test-only reachability and active fairness paths

All outcome fixtures are separate from normal play and require an offline `state/test-next.json` file, consumed by one mutating request. HTTP parameters cannot select these fixtures. Namespaced tracing wrappers delegate to native PHP rand/mt_rand/shuffle normally. For marked tests only, selected rand calls return valid in-range draws that choose existing win/bonus/gamble paths; the original reel sampling, rejection, payout and settlement code still executes. No fixture file remains pending. Hooks are pinned to this exact source's lines and must not be reused against another version without revalidation.

Bonus testing also set the **disposable** game's aggregate stat_in to 100000 to pass the existing history-conditioned bonus gate; it did not change that gate. The end-of-feature test changed only the persisted free-spin counter to 29. These fixture state selections are logged in `bonus-fixture.json` and `free-spin-end.json`. They are not fair-math remedies or production configuration recommendations.

ACTIVE RNG: The initial unforced spin traced `rand` in GetSpinSettings (SlotSettings.php:1070–1071), `mt_rand` in GetReelStrips (:1186), and `shuffle` in GetRandomPay (:501). There were 32 traced calls: two mode draws and five candidate boards, each with five reel draws plus a payout shuffle. Client RandomInt is used for initial/animation fillers; the stopped result exactly matches the server. No RNG replacement was made.

ACTIVE RTP/FILTERING: The normal spin used original shop percent/configuration, GetSpinSettings, GetRandomPay, GameBank access and the server's candidate acceptance/rejection loop. Four candidates were discarded before the final no-win board. GetRandomPay consults aggregate game stat_in/stat_out. The RTP control counter initialized at 200 and decremented; its later suppression phase was not reached. The low-player-balance push branch exists but was not taken at this demo balance. Constructor Percent selection also depends on count_balance/address; the test used count_balance>0/address=0. Bank limits and mode-conditioned rejection are retained; positive-win and bonus tests traverse those existing conditions. History-conditioned bonus gating required the explicit fixture described above. These paths are unsuitable evidence of a legitimate fixed global math profile. Nothing was tuned or remediated.

FUTURE RTP REQUIREMENT — RECORDED ONLY: Admin-controlled RTP per game; enabled profiles may be 50/60/70/80/90/95 percent or a validated custom profile. One active version applies to all players. Never player/session/history/balance targeting and never rejecting an already generated win to hit a target. Changes apply to new rounds only, are versioned and audit logged; OFF selects the game's default validated math profile. None of this has been implemented or validated here.

## Network, captures and evidence

OUTBOUND NETWORK: Zero non-loopback page requests observed in recorded browser tests. Browser routing rejects non-loopback traffic and WebSockets; service workers are blocked. CSP restricts resources to self. PHP binds only 127.0.0.1:8766, validates Host and local session, disables URL fopen/include, process execution and socket-creation functions, and loads no curl/socket extension. Only inspected original source and required methods execute. No provider connection, real credential, wallet or production service was used. This is application/runtime containment, not a machine-wide packet-capture claim.

DESKTOP: New real-backend 1440×900 captures in the external runtime directory:

- [Normal final board](C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/screenshots/normal-final.png)
- [Spin](C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/screenshots/normal-spin.png)
- [Win](C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/screenshots/win.png)
- [Gamble entry transition](C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/screenshots/gamble.png)
- [Free-spin trigger](C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/screenshots/free-spin-trigger.png)
- [First free-spin animation](C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/screenshots/free-spins.png)

MOBILE: The accepted 430×932 visual capture remains unchanged; this narrowed resume did not repeat mobile preview or claim mobile gameplay validation.

Verification command `python docs/agent-work/lucky-lady-runtime/harness/verify.py` passed: real initialization evidence, exact/stable board, one debit and replay, collect, red-win/black-loss, no free-spin wager, retrigger/end protocol, reconciled ledger, unchanged backend hashes and all 185 client blobs. Runtime evidence is under external `evidence/`; full request/result/RNG traces are in `logs/protocol.jsonl`. Page errors: zero in successful gameplay sessions. An initial unsupported collect hotkey caused an automation timeout, not a backend/gameplay failure; the actual original collect control was then tested successfully.

BLOCKERS: None for the minimum end-to-end compatibility proof. Remaining limits are native recovery, native retry identity, fairness/RNG/RTP, missing sound-list configuration, untested progressive jackpots and unexercised complete bonus outro. Those belong to later work. No Fool's Gold integration or other-game changes were made.
