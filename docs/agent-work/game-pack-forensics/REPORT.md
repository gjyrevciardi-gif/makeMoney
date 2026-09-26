# Game pack forensics — 2026-09-26

## 1. Executive conclusion

**None of the audited repositories satisfies the requirement for 100+ actual local game clients with assets and game-specific backends.** These are substantial backend collections, but their catalogue sizes do not describe playable client packs.

The strongest **reference** is taxipult/goldsvet: **1,184 actual backend game directories, two directories containing substantive client code/assets, and zero complete games established from the checked-in files**. Both client-bearing games have concrete missing dependencies. Promex contains 1,092 backend game directories but no game client asset directories. Zeusbyte contains the lobby/admin shell without the casino backend or game clients at the inspected commit.

The backend code is not merely an API catalogue: it implements reels, paytables, protocol messages, free-spin state, gamble and other game-specific mechanics. However, sampled outcomes are conditioned on bank funds, accounting history and, in the legacy family, player balance/accounting state. **No sampled backend is acceptable as-is under the requirement for legitimate global math profiles.** Preserving game-specific mechanics is possible in principle, but removing outcome manipulation and repairing settlement/security would be substantive work.

No casino server, client JavaScript, PHP, binary, installer or dependency installation was executed. Playability and original-provider visual parity were not tested. This is a static audit, not a certification of the unsampled backends or a proof that a complete private/external pack does not exist.

## 2. Repository comparison

| Repository | Pinned commit | Tree files | Verdict |
|---|---|---:|---|
| [taxipult/goldsvet](https://github.com/taxipult/goldsvet/tree/661bc54ddc31ce952c142426d783756c4047a484) | `661bc54ddc31ce952c142426d783756c4047a484` | 21,956 | **REFERENCE_ONLY** |
| [promexdotme/opensource-casino-8.5](https://github.com/promexdotme/opensource-casino-8.5/tree/e687f02dad1119711f4dc990c84cdae17ce71c5a) | `e687f02dad1119711f4dc990c84cdae17ce71c5a` | 29,687 | **REFERENCE_ONLY** |
| [zeusbyte/goldsvet](https://github.com/zeusbyte/goldsvet/tree/44e0b873b3ad4cddc2ad12469668d9385f68f164) | `44e0b873b3ad4cddc2ad12469668d9385f68f164` | 11,499 | **REJECT** |

| Required verdict field | taxipult | promex | zeusbyte |
|---|---|---|---|
| ACTUAL BACKEND GAMES | 1,184 directories; +3 separately listed JS modules | 1,092 directories; +3 separately listed JS modules | 0 |
| ACTUAL FRONTEND GAMES | 2 with substantive but incomplete clients | 0 | 0 |
| ACTUAL COMPLETE GAMES | 0 | 0 | 0 |
| PROVIDERS | 24 repository DB provider labels; counts below | Same labels; fewer Pragmatic entries | No actual games to attribute |
| PLAYABLE LOCAL | No complete launch demonstrated; concrete file gaps | No game clients | No game clients/backend |
| FULL CLIENTS | 0 verified; 2 incomplete candidates | 0 | 0 |
| BACKEND QUALITY | Substantial mechanics, copied configuration, fairness defects | Substantial legacy mechanics; shared defects | Absent |
| RNG QUALITY | Sampled `rand`, `mt_rand`, `array_rand`; JS arcade `Math.random` | Sampled legacy `rand`/`mt_rand`; matching shared code | Not applicable |
| RTP MODIFIABLE | Yes, source/config; current controls are not fixed global math | Yes; same qualification | Not applicable |
| SECURITY RISK | **HIGH** | **HIGH** | **MEDIUM**, limited shell-only assessment |
| 1:1 UI POTENTIAL | UNKNOWN for requested samples; MEDIUM for two incomplete client remnants | UNKNOWN | UNKNOWN |
| MISSING DEPENDENCIES | Public game pack, client boot/assets, PHP dependencies/configuration | Public game pack and environment | Entire casino application and game packs |

The larger promex tree is not a larger client catalogue: it includes `casino/vendor` and multiple lobby themes. All **1,092 overlapping game launcher templates are byte-identical Git blobs** between promex and taxipult. Of 5,527 overlapping files under `casino/app/Games`, 5,249 have identical blob IDs. This is substantially the same lineage, not two independent source packs to add together.

## 3. Actual game counts and method

| Count from real tree paths | taxipult | promex | zeusbyte |
|---|---:|---:|---:|
| Raw immediate directories under `casino/app/Games/` | 1,185 | 1,092 | 0 |
| Actual backend game directories after orphan exclusion | **1,184** | **1,092** | **0** |
| Directories with client JS/HTML plus substantial game content | **2** | **0** | **0** |
| Directories with in-game image/audio/atlas assets | **2** | **0** | **0** |
| Complete frontend+assets+backend+configuration | **0** | **0** | **0** |
| Game launch Blade files, explicitly NOT full clients | 1,184 | 1,092 | 0 |
| Arcade backend JS modules in a shared directory | 58 | 58 | 0 |
| Arcade module IDs not already present as PHP game directories | 3 | 3 | 0 |

Counts use full recursive `git ls-tree`, not GitHub's potentially truncated recursive API tree, README totals, database rows, icons or marketing titles. Each counted PHP game directory has nonempty `Server.php`, `SlotSettings.php`, `GameReel.php` and `reels.txt`. Content inspection was deep for the ten selected samples and the two client-bearing exceptions; remaining backend classifications are structural and provisional.

Taxipult's excluded `DelGames/Server.php` declares `VanguardLTE\Games\ShiningCrownEGT`, lacks the other core files and a launcher, and is an orphan copy rather than an additional game. [Exact orphan source](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/DelGames/Server.php#L2).

The 58 arcade JS modules are server code, not browser clients. Fifty-five overlap the PHP directory IDs. `LetsShootAG`, `OceanHeavenVP` and `OceanLordAG` are additional backend modules, recorded separately in the inventory; they do not increase frontend/complete counts. Desktop/mobile variants such as `GT/GTM` and `PT/PTM` remain separate **directory** counts. Nested backup copies and generic shared asset directories are not counted again. These totals must not be advertised as distinct original titles.

No submodule or symlink entries were found in the three trees. The relevant `.gitattributes` files contain text/vendoring rules, not LFS filters. Cached file contents were verified against the pinned Git blob SHA-1s; no positive completeness claim depends on an unmaterialized asset/LFS pointer.

Classification used in `inventory.json`:

| Class | Meaning in this audit | taxipult raw directory rows | promex rows |
|---|---|---:|---:|
| A | Full local client + assets + backend, with no established file gap | 0 | 0 |
| B | Complete frontend/assets, backend absent/incomplete | 0 | 0 |
| C | Backend core present; client absent; structural, not runtime certification | 1,182 | 1,092 |
| D | Remote provider/API wrapper without local game logic | 0 established game-directory rows | 0 established game-directory rows |
| E | Stub/marketing only | 0 game-directory rows | 0 game-directory rows |
| F | Known broken dependencies/orphan | 3: two clients and `DelGames` | 0 primary rows; missing clients are orthogonal F flags |
| G | High-risk flag, overlapping structural classes | Content-audited backends flagged | Repository-level inherited concern; sample evidence below |

Zeusbyte has zero game rows; its pack-level shell is not converted into fictitious E-class games. Local iframe launchers are not automatically class D: an iframe targeting missing `/games/...` content is a missing local client, not evidence of a working remote provider integration.

## 4. Provider counts

Attribution comes from actual SQL configuration joins: `w_games.name/id` → `w_game_categories.game_id/category_id` → `w_categories.title`, intersected with the real backend directory IDs. Sources: [taxipult v10.sql](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/v10.sql) and [promex betshopme_8.sql](https://github.com/promexdotme/opensource-casino-8.5/blob/e687f02dad1119711f4dc990c84cdae17ce71c5a/betshopme_8.sql). Sample attribution is additionally supported by launcher protocols/paths and source namespaces. No provider count comes from README assertions.

These are **repository-attributed backend variants**, not authenticated provider source, licenses, or official math. Counts are nonexclusive: 12 taxipult and 11 promex directories carry multiple retained provider labels; their ambiguity is preserved rather than resolved by guessing. Generic/custom categories (`Arcade`, `Slots`, `Card`, `New`, `Jackpots`, `Evolution`) are not treated as original-provider proof. Forty actual directories in each backend repo remain unattributed after filtering. Every game's raw category labels are preserved for review.

| Requested provider | taxipult backend directories | promex backend directories | Complete clients in either |
|---|---:|---:|---:|
| Novomatic | 69 | 69 | 0 |
| Greentube | 173 | 173 | 0 |
| Novomatic/Greentube combined | **242** | **242** | 0 |
| EGT | 137 | 137 | 0 |
| Pragmatic | 105 | 12 | 0 |
| NetEnt | 23 | 23 | 0 |
| Playtech | 140 | 140 | 0 |
| Amatic | 107 | 107 | 0 |
| Aristocrat | 24 | 24 | 0 |
| Merkur | 0 confirmed | 0 confirmed | 0 |
| APEX | 0 confirmed | 0 confirmed | 0 |
| Ainsworth | 0 confirmed | 0 confirmed | 0 |
| PGSoft | 0 confirmed | 0 confirmed | 0 |
| Evoplay | 0 confirmed | 0 confirmed | 0 |

Zero confirmed means no supported attribution in the inspected tree/configuration, not proof that no title resembles that provider. In particular, the `PG` suffix must not be silently mapped to PGSoft: the database identifies a `Playngo` category with eight entries.

Other supported DB labels, same counts in both: Amatic/EGT/etc. above plus BetSoft 10, C-Technology 30, CQ9 Gaming 9, GD Games 6, Gamomat 60, Igrosoft 17, Igtech 12, Ka-Gaming 66, Mainama 32, NetGame 25, Playgt 12, Playngo 8, Skywind 23, Vision 25, Wazdan 32 and iSoftBet 11. Taxipult's two incomplete clients are C-Technology's `AmericanGigoloCT` and iSoftBet's `AztecGoldMegawaysISB`; none of the requested ten samples has its client assets in-tree.

## 5. Ten-game deep audit

All code locations below refer to the pinned taxipult commit, except explicitly noted comparisons. Eight selected exact/deluxe/closest variants also have backend directories in promex; Sweet Bonanza and Gates of Olympus do not. Zeusbyte has none. **Gonzo's Quest is absent from filenames, game directories and launchers in all three.** Jumanji is used only as a NetEnt adventure-themed substitute to inspect a second distinct NetEnt state machine; it is not a substitute implementation of Gonzo's cascade mechanics.

### Frontend and presentation checklist applying to EACH sample

For each of the ten rows below, the Blade launcher is present in taxipult but the referenced public client is absent. Accordingly: **symbols/assets: missing; backgrounds: missing; audio: missing; working controls: missing; client paytable/help: missing; autoplay implementation: unverified/missing; mobile layout implementation: unverified/missing.** Mobile branches or a viewport tag prove launch intent only. Framework names below are inferred from actual script references, not from a runnable engine.

For **each** sample: reel direction, reel stop order, symbol bounce/stop behavior, win highlighting, anticipation animation and transitions are **UNKNOWN** because their implementation files are missing. Backend reel geometry or win fields cannot establish animation behavior. Special bonus screens are missing even where the server has bonus state. All ten have **UI_MATCH_LIKELIHOOD: UNKNOWN** and **PLAYABLE_LOCAL: NO_AS_CHECKED_IN**.

| # / title and actual ID | Client entry/framework evidence; missing path | Grid/reel evidence, not observed rendering |
|---|---|---|
| 1 Book of Ra Deluxe — `BookOfRaDXGT` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/BookOfRaDXGT.blade.php#L19): Pixi/CreateJS; `GameUI`, `GameReels`, `GameRules`, `GameGamble`, `GameBonus`, loader under `/games/BookOfRaDXGT/js/` all absent | Five columns × three rows in `SlotSettings.php:204`; ten-line configuration |
| 2 Lucky Lady's Charm Deluxe — `LuckyLadysCharmDX` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/LuckyLadysCharmDX.blade.php#L19): same named Pixi/CreateJS modules under its own missing `/games/` directory | Five × three configured |
| 3 Sweet Bonanza — `SweetBonanza` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/SweetBonanza.blade.php#L39): local iframe to `gs2c/html5Game.html`; engine bundle absent | Six reel arrays × `sh=5` in `init.php`; 6×5 backend field |
| 4 Gates of Olympus — `GatesofOlympus` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/GatesofOlympus.blade.php#L39): local `gs2c/html5Game.html`; engine absent | Six arrays × `sh=5`; 6×5 backend field |
| 5 40 Super Hot — `SuperHot40EGT` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/SuperHot40EGT.blade.php#L9): EGT desktop/mobile initializer and socket config; game ID 804; initializer files absent | Server's initial payload has four symbols per each of five reels (`Server.php:125`); generic settings say five × three. **Configuration inconsistency**, not verified provider parity |
| 6 Burning Hot — closest `BurningHot20EGT` (20-line variant) | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/BurningHot20EGT.blade.php#L9): EGT, game ID 530; missing desktop/mobile initializer | Five × three; 20-line server fields |
| 7 Starburst — `StarBurstNET` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/StarBurstNET.blade.php#L66): `games/starburst_mobile_html/game/starburst_mobile_html.xhtml`, `operatorId=netent`; missing XHTML/client | Five × three; held/expanded wild reel response fields |
| 8 Gonzo's Quest absent; audited `JumanjiNET` instead | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/JumanjiNET.blade.php): missing NetEnt client; exact Gonzo client/backend absent | Five × three generic settings; some initialization payloads emit four-symbol reels (`Server.php:155`); do not infer authentic geometry |
| 9 Playtech — `DolphinReefPT` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/DolphinReefPT.blade.php#L4): `platform/` GLS scripts and `platform.nocache.js` (GWT-style loader naming); files absent | Five × three configured |
| 10 Amatic — `BookOfFortuneAM` | [Launcher](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/resources/views/frontend/games/list/BookOfFortuneAM.blade.php#L5): `amarent/`, `webgl-2d.js`, `bookoffortuneloader_00516940.js`; files absent | Five × three configured |

### Game-specific mechanics and backend evidence

**Common integration/persistence facts for all ten:** launch route `GET /game/{game}` and spin route `POST /game/{game}/server` are defined in [routes/web.php:147–148](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/routes/web.php#L147). [GamesController.php:1243–1282](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Http/Controllers/Web/Frontend/GamesController.php#L1243) checks authenticated player role, tracks subsessions and instantiates `VanguardLTE\Games\{game}\Server`. These are local backends, not remote API calls. Legacy samples use serialized per-user session data, game logs, direct balance changes, bank rows and shop configuration. The Pragmatic samples use `PragmaticLib/Log.php`, `LogAndServer.php`, `SwitchMoney.php`, `Collect.php` and game-log persistence instead. No idempotent round-replay guarantee was established; an `index` or `counter` echoed into a response is not evidence of one.

**Backend reuse decisions below:** `WITH FIXES` means retain useful game-specific logic as a candidate, with mandatory fairness/RNG/settlement/security repairs. It never means acceptable as-is. No sample earns `YES`. `NO` applies to the absent exact Gonzo implementation. Unknown/unobserved features below must not be interpreted as implemented because another provider version has them.

**1. Book of Ra Deluxe.** [Server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/SlotSettings.php).
`getSettings`, `bet`, `freespin`, `slotGamble` and card-gamble paths are implemented. `GameReel.php:24` loads `reels.txt`; paytable starts at settings line 80. Ten free games, scatter/wild substitution, selected expanding symbol, expansion payout and +10 retrigger paths are present (`Server.php:546–583, 669–681`; settings 234–241). Recovery reads the last event and expanding symbol at server 58–80. Gamble uses `rand` at 87/238 and is forced to lose when the bank cannot cover doubling at 137/247. No bonus-buy or cascade path was established; multipliers are configured as 1. Feature screens are absent. **RNG:** settings 1164 `mt_rand` for reel positions, 1027–1028 `rand` for win/bonus selection. **RTP:** settings 906–1070; server rejection loop 585–638. **Reuse: WITH FIXES** — remove player/history/bank-conditioned outcomes and forced gamble losses, repair RNG/reel sampling, preserve expansion/retrigger/recovery semantics, then validate wallet/auth/idempotency and security.

**2. Lucky Lady's Charm Deluxe.** [Server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/LuckyLadysCharmDX/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/LuckyLadysCharmDX/SlotSettings.php).
Legacy bet/freespin/gamble state exists. Settings 243–250 enable bonus, 15 free games, wild multiplier 2 and free-game multiplier 3; server 654 adds retriggers. Scatter/wild calculations and paytable are local; `GameReel.php:24` loads strips. No expanding-symbol, bonus-buy or cascade implementation was established. `getSettings` is present, but recovery correctness across every state is untested. **RNG:** settings 1186 `mt_rand`; server 67/214 `rand` for gamble. **RTP:** settings 949 onward and player-balance push at 1101; server 113–115 suppresses a gamble win for insufficient bank funds. **Reuse: WITH FIXES** — legacy fairness controls, RNG, wallet/auth, duplicate settlement, recovery and shared security; preserve 15-spin/retrigger/multiplier logic.

**3. Sweet Bonanza.** [Backend directory](https://github.com/taxipult/goldsvet/tree/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/SweetBonanza), [spin](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/SweetBonanza/PragmaticLib/Spin.php).
`Server.php:55–70` dispatches `doInit`, `doSpin`, `doCollect`. Live math comes from `init.php`, not merely the legacy-looking `reels.txt`: six strips, 30-position paytable, `settings_fs=10`, four scatters to trigger, three to retrigger +5 (init 41–44). `SlotArea.php:31–79` removes winning symbols and refills the field; `FreeSpin.php` and `Multiple.php` implement free games and multipliers; bonus buy is `fsp === '0'`, multiplying stake by 100 (`Spin.php:20,30`). No actual substitute-wild/expanding-symbol or gamble action was established; a `wilds=` protocol field alone does not prove gameplay. Bonus screens are missing. **RNG:** `SlotArea.php:17` calls `rand(0, count(strip))`; `Multiple.php:54` uses `array_rand`. The inclusive upper bound duplicates the first cyclic stop and deserves repair. **RTP:** `init.php` strip/paytable/feature weights; `SwitchMoney.php:20` shop-percent bank allocation; `WinPermission.php:15,21,41` rejects unaffordable wins and `Spin.php:60` redraws. **Reuse: WITH FIXES** — bank-conditioned redraw, RNG, bonus-buy affordability (initial guard only checks base stake), transaction/locking scope, input constraints, idempotency, collect/recovery and security. The unused/dormant legacy settings must not be mistaken for proof of active per-user RTP in this live path.

**4. Gates of Olympus.** [Backend directory](https://github.com/taxipult/goldsvet/tree/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/GatesofOlympus), [spin](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/GatesofOlympus/PragmaticLib/Spin.php).
Same `doInit/doSpin/doCollect` protocol family, but game-specific `init.php` has 15 free games, four scatter trigger, three-scatter +5 retrigger (53–56). Cascades/refills and buy-free-spin flow exist. `LogAndServer.php:233–257` maintains accumulated `PrgSum` multipliers; it is not interchangeable with Sweet's state semantics. No working wild-substitution/expansion or gamble action established; screens absent. **RNG:** `SlotArea.php:17` inclusive `rand` stop; `Multiple.php:54` `array_rand`. **RTP:** init math, `WinPermission.php:21,42`, `Spin.php:61` redraws rejected results. **Reuse: WITH FIXES** — remove bank suppression, correct RNG bounds, validate independent math and `PrgSum` recovery, wallet/auth/transactions/idempotency/security. Preserve cascade and accumulated multiplier state rather than replacing it with a generic slot endpoint.

**5. 40 Super Hot.** [Server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/SuperHot40EGT/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/SuperHot40EGT/SlotSettings.php).
EGT command protocol includes login/bet/collect/gamble, line/scatter results and local paytable/strips. Recovery reads the last log at server 120. Gamble decision uses `rand` at 806. **Do not claim free games:** `slotBonus=false` at settings 207 despite generic free-game fields. No buy/cascade/expanding feature established; wild/scatter behavior is not certified from copied generic metadata. **RNG:** settings 1111 `mt_rand` in `GetReelStrips`; gamble server 806. **RTP:** settings 875 `GetSpinSettings`, shop percentage, history limits, low-balance push at 1027 and bank-gated server acceptance. **Reuse: WITH FIXES** — legacy fairness/RNG/settlement/security plus reconcile reel geometry and copied `RTP.G6` title (`PantherMoonPT`), then verify EGT event sequencing.

**6. Burning Hot, 20-line variant.** [Server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BurningHot20EGT/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BurningHot20EGT/SlotSettings.php).
EGT login/bet/collect/gamble, reel/paytable/scatter response and last-event recovery are present. `slotBonus=false` at settings 231: the `slotFreeCount=20`/multiplier 3 values are not proof of reachable free games. No bonus buy/cascade/expanding-symbol path established. **RNG:** settings 1137 `mt_rand`, gamble server 690 `rand`. **RTP:** settings 901 onward, low-balance push 1053, bank constraints; copied `RTP.G6` says Panther Moon. **Reuse: WITH FIXES** — same legacy fairness/RNG/settlement/auth/recovery/security requirements, with verification of actually reachable features.

**7. Starburst.** [Server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/StarBurstNET/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/StarBurstNET/SlotSettings.php).
NetEnt-style `spin/init/paytable` mapping, wild symbol `'1'`, no scatter (`Server.php:370–371`), held wild reels 374–381 and hold updates 498–505. Internal `freespin` state is used for the wild-respin flow; it does not prove a separate free-games bonus. No gamble, bonus buy or cascades established; no special screens exist locally. Local strips/paytable and log recovery are present. **RNG:** settings 1169 `mt_rand`. **RTP:** settings 884 onward, low-balance push 1035, bank filtering. Commented time-win-limit blocks in the server are not counted as active controls. **Reuse: WITH FIXES** — retain held/expanding-wild state; repair legacy fairness/RNG, wallet/auth/idempotency/recovery/security and verify bidirectional win evaluation separately.

**8. Gonzo's Quest absent; Jumanji substitute.** [Jumanji server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/JumanjiNET/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/JumanjiNET/SlotSettings.php).
Exact Gonzo: no frontend, assets, server, math, RNG location or RTP controls to inspect; **reuse NO**. Jumanji: server 31–75 dispatches bet/freespin/respin/shuffle and board bonus actions; 309–346 emits wild-reels/random-wild/shuffle feature choices. Paytable/reels and bonus/free-game recovery exist. A shuffle is not evidence of Gonzo's avalanche mechanic. Exact retrigger/multiplier parity, gamble, bonus buy and cascade behavior remain unestablished; bonus screens absent. **RNG:** settings 1188 `mt_rand`; server also `rand` for board/initialization decisions. **RTP:** settings 903 onward, low-balance push 1054, bank/history controls. **Jumanji reuse WITH FIXES** — same legacy controls plus board/shuffle/bonus recovery and geometry validation.

**9. Dolphin Reef (Playtech).** [Server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/DolphinReefPT/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/DolphinReefPT/SlotSettings.php).
Local bet/freespin protocol, strips, paytable, wild/scatter calculation, free-game counters and +5 retrigger path (server 546; settings 242) exist. No bonus buy/cascade/expanding-symbol or reachable gamble branch established in this server. Protocol initialization/restoration exists but reconnect correctness is untested. **RNG:** settings 1105 `mt_rand`. **RTP:** settings 889 onward, low-balance push 1041, server 251–252 selects bank/win type. **Reuse WITH FIXES** — preserve Playtech-specific message/state handling; repair fairness/RNG/wallet/auth/idempotency/recovery/security and verify feature parity against an authorized reference.

**10. Book of Fortune (Amatic).** [Server](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfFortuneAM/Server.php), [settings](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfFortuneAM/SlotSettings.php).
Compact Amatic events `A/u251` (spin), `A/u256` (free game), `A/u257` (gamble) exist. Ten free games, scatter, wild/selected `FreeSym` expansion payout (server 553–575), retrigger +10 at 663 and log recovery at 150–151. Gamble settles through its own protocol (log at 1007). No bonus buy/cascade path established; configured multipliers 1. **RNG:** settings 1182 `mt_rand`, additional `rand` selection paths. **RTP:** settings 944 onward, low-balance push 1095 and historical/bank controls; `currentRTP` is computed from game stats at 77. **Reuse WITH FIXES** — retain Amatic expansion/gamble/state sequence, remove targeting/bank/history shaping, repair RNG and wallet/auth/idempotency/recovery/security.

## 6. Frontend completeness: the two substantive exceptions

**AmericanGigoloCT — F, not A/B.** Taxipult contains 235 files under its game directory, including `latest-stable/AmericanGIgolo/app.html`, JQuery/CreateJS SoundJS and a substantial `second2.min.js` game UI, help/asset manifests, symbol images, backgrounds and audio. `.as` files here are JSON-like manifests, not proof of an available ActionScript build system. Controls, free-game backgrounds, help and gamble assets are real. [Entry HTML](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/AmericanGigoloCT/latest-stable/AmericanGIgolo/app.html#L13) requests `rgs/first1.min.js` and `rgs/preloader2.min.js`; **both are zero-byte Git blobs**. The entry calls `new App()` after loading them. Asset manifests also reference `../../gamescontent/1024_COMMON/...`, whereas stored images live under `html-interface-stable/1024/games/...`; this requires reconciliation, not an assumption that same-basename files work. Framework/runtime build source is incomplete. UI likelihood **MEDIUM**, supported by game-specific assets/config/UI code, but no rendered comparison. Promex has backend files and `response_template.json` only.

**AztecGoldMegawaysISB — F, not A/B.** Taxipult contains 243 files: HTML entry, roughly 2.66 MB game JS bundle, vendor bundle identifying Pixi, desktop/mobile layouts, Spine animation atlases, audio, backgrounds and paytable/feature screen sprites. These are substantive provider-style client remnants, not a marketing screenshot. However, desktop manifest [lines 187–192](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/AztecGoldMegawaysISB/pulse_aztec_gold/graphicsSprite/manifest_desktop.json#L187) requires absent `spritesheets/Symbols.desktop.json` and `Symbols.desktop1.json`. Mobile manifest [lines 323–328](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/AztecGoldMegawaysISB/pulse_aztec_gold/graphicsSprite/manifest_mobile.json#L323) similarly requires absent symbol sheets; line 423 requires absent `spritesheets/WinText.mobile.landscape.json`. Layout names are transformed by the loader, so an unprefixed layout filename is **not** itself counted as a missing file; the concrete missing spritesheet paths are sufficient. Minified game bundle/build pipeline provenance is unverified. UI likelihood **MEDIUM**, not HIGH: game-specific layouts/animations/assets exist, but symbol data is incomplete and no original-vs-local rendering was performed.

For the ten requested samples, `frontend/Default/ico/<title>.jpg` is only a lobby thumbnail. Neither those icons, the alternate lobby skins, nor the 1,184 Blade wrappers are playable game clients.

## 7. Backend completeness and local launch requirements

The legacy family supplies substantial PHP source with per-game namespace, reel loader, math table, state and response formatting. The Pragmatic additions include separate cascade/multiplier/collect/free-spin modules. This supports the user's strategy of retaining game-specific backends. It does **not** establish correctness or clean separation from the platform.

Backend dependencies include Vanguard models for users, shops, games, banks, logs and jackpots; Laravel auth/session/config; SQL schema/seed data; and, for socket families, the bundled `PTWebSocket` services. Taxipult's checked-in [composer.json:8–33](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/composer.json#L8) requires **Laravel 9.x**, even though marketing mentions a newer version. The broad PHP constraint is not a complete compatible runtime specification. Taxipult has no `casino/vendor` tree; promex does, but vendored packages are not proof of compatible or safe installation. `install.php` is only 121 bytes and is not a complete installer.

**Exact static launch paths/requirements; not executed:**

1. All sampled games require the PHP/Laravel application and database models, an authenticated player assigned to a shop, per-shop game/bank/log rows, and the routes above. The front controller requires a Composer autoloader. A standalone HTML file cannot replace these dependencies.
2. Public client content must resolve at `/games/<ID>/...` exactly as each launcher specifies. The checked-in files do not provide it for any of the ten samples. There is therefore no complete local launch command to record for them.
3. EGT launchers fetch `/socket_config.json` and desktop/mobile initializer JS; the repository configuration targets `betshop.io`, port/path `22154/slots`. Arcade uses `22188/arcade`; second socket config uses `22197`. Local transport, session forwarding and trusted local TLS would require configuration. No remote endpoint was contacted.
4. American Gigolo's exact candidate entry is `/games/AmericanGigoloCT/latest-stable/AmericanGIgolo/app.html?serverurl=/game/AmericanGigoloCT/server&...`, with session/config established by its Blade launcher. Missing bootstrap scripts and asset-path mappings prevent declaring it runnable. Do not expose `casino/app` itself as a public directory.
5. Aztec's exact candidate entry is `/games/AztecGoldMegawaysISB/pulse_aztec_gold.html`, with its sibling `pulse_aztec_gold/`, `device.js`, `addon.js` and launch parameters from the Blade view. Missing manifests/assets and transport mapping must be resolved before a local pilot. The bundle retains iSoftBet staging/demo host options; no offline default is assumed.

**Mandatory fixes before any backend could be accepted:** RNG and math validation; remove bank/player/history outcome conditioning; integer-safe/auditable wallet integration; authenticated and scoped game launch; validated wager/action inputs; atomic settlement; request idempotency; reconnect/recovery across bonus/gamble/collect; removal of shipped keys/seeds and review of remote-code paths. Existing `lockForUpdate` calls and legacy transaction wrappers do not prove all of these properties. Sweet/Gates call locks without a transaction visible in their `Server.php` path; no repository-wide atomicity claim is made. This audit does not redesign the architecture or require replacing every game backend.

## 8. RNG, RTP and critical fairness findings

| Finding | Exact evidence | Interpretation |
|---|---|---|
| Non-cryptographic outcome PRNG | Sample-specific locations above; [Book settings:1164](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/SlotSettings.php#L1164) | `mt_rand`/`rand` are used directly; no CSPRNG replacement or fairness proof found in sampled outcome paths |
| Inclusive-bound sampling defect | [Gates SlotArea:17](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/GatesofOlympus/PragmaticLib/SlotArea.php#L17); same Sweet path | `rand(0,count(strip))` includes an extra position; cyclic append makes it duplicate the first stop rather than sample each stop once |
| Arcade custom RNG helpers | [Utils.js:125,156,163](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/PTWebSocket/arcade_server/Utils.js#L125) | Shuffle/integer/custom random helpers use `Math.random` |
| Player accounting changes payout funding | [Book settings:309–321](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/SlotSettings.php#L309) | `Percent` becomes 0 or 100 depending on user `address`/`count_balance`; this is not a fixed global math profile |
| Explicit low-balance outcome targeting | [Book settings:1058–1067](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/SlotSettings.php#L1058), analogous locations for eight legacy samples above | Player balance can force `win` selection with a randomized push |
| History-dependent RTP correction | [Book settings:965–1025](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/SlotSettings.php#L965) | Uses cumulative game `stat_out/stat_in`, `SpinWinLimit`, `RtpControlCount` to alter bonus/spin chance and maximum win; not independent fixed-distribution spins |
| Bank-conditioned result rejection | [Book server:612–638](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/Server.php#L612) | Chooses/accepts results according to win type and bank limit |
| Forced-loss fallback/gamble suppression | [Book server:585–587](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/BookOfRaDXGT/Server.php#L585), 137–139 and 247–249 | Excess retries set `winType=none`; insufficient bank sets gamble win flag to zero |
| Sweet/Gates bank-dependent redraw | [Sweet Spin:57–60](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/SweetBonanza/PragmaticLib/Spin.php#L57), [Gates WinPermission:20–42](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/GatesofOlympus/PragmaticLib/WinPermission.php#L20) | Wins over slots/bonus bank are rejected and generated again |

RTP/payout behavior is modifiable in source, but `shop.percent` is not simply a certified global RTP selector. It interacts with bank allocation and win-frequency configuration. `GetRandomPay`, `increaseRTP`, `jpgPercentZero`, `MaxWin` and line-percent JSON also affect accepted results. `RTP.G6` is not reliable evidence of certified math: several sampled copies literally identify Panther Moon instead of the surrounding game, and active legacy strips are loaded from `reels.txt`; active Pragmatic strips come from `init.php`.

**Per-user RTP:** explicit low-balance outcome targeting and per-user accounting-dependent `Percent` are confirmed in the legacy sample family. A separately named administrator-editable numeric `user.rtp` or a hidden admin “win this next spin” endpoint was **not established**. History-driven correction is confirmed; its counters are serialized into the game record (`SlotSettings.php:478`), so this control is game/shop-scoped rather than a demonstrated per-session numeric RTP setting. Scope must not be mislabeled as purely per-user when it reads game aggregates. Ordinary feature-state recovery is not itself unfair RTP manipulation. Sweet/Gates live paths confirm bank filtering, but copied legacy settings are not evidence that all of the older targeting logic runs there.

`skipWin`-like strings in the Aztec client refer to UI skipping of win presentations; they are not independently counted as backend forced-loss evidence. Commented-out PHP `panic` callback and commented time-win-limit code are reported as dormant code, not confirmed live backdoors. No math/configuration was changed.

## 9. Security findings

**Scope:** representative game servers/settings and Pragmatic helpers, shared game/controller/middleware/lib code, all taxipult launch templates (which cover all 1,092 byte-identical promex templates), two embedded client bundles/configs, first-party socket code, root package metadata, SQL structure/seeds and full-tree binary/path inventory. This is not an exhaustive dependency/CVE or all-backend security audit.

| Severity / area | Evidence | Finding and limit |
|---|---|---|
| HIGH — shipped private keys | `casino/PTWebSocket/ssl/key.key:1` in both backend repositories | Actual private-key header present, not just a filename. Values not reproduced. Current deployment validity unknown; these files cannot be reused as private credentials |
| HIGH — client-side arbitrary code sink | [American Gigolo casino_settings1.min.js:15,30](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/AmericanGigoloCT/latest-stable/system/casino_settings1.min.js#L15) | URL `exit_js` is read and later passed to `eval`. This is a concrete browser-code execution sink; no claim of server RCE |
| HIGH — another dynamic code sink | [Aztec bundle:2](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Games/AztecGoldMegawaysISB/pulse_aztec_gold/js/pulse_aztec_gold.js#L2) | `pulseAPIVO.jsCode` can be evaluated; trust/source boundary requires review. It is not proof of an active command-and-control service |
| HIGH — monetary fairness/integrity | Section 8 and direct balance/bank changes | Bank filtering, targeting and missing established idempotency preclude production reuse |
| MEDIUM/HIGH — CSRF/session boundary | [VerifyCsrfToken.php:7](https://github.com/taxipult/goldsvet/blob/661bc54ddc31ce952c142426d783756c4047a484/casino/app/Http/Middleware/VerifyCsrfToken.php#L7) | `/game/*/server` exempt; controller does check auth/player role. Review origin/session binding; do not misreport endpoint as unauthenticated |
| HIGH if reused — database seeds/config | Both SQL dumps; taxipult `.env.example:4` | User/password-hash, role, session and payment-setting seeds exist; debug enabled in example. No credential values included. Plaintext hardcoded admin password in executable code was not confirmed |
| MEDIUM — remote endpoints | Socket configs and client host strings below | Operational third-party/staging origins survive; do not assume offline-only behavior |
| MEDIUM — bundled executable | `back/bower_components/bootstrap-datetimepicker/src/nuget/NuGet.exe` in all three trees | Executable is present as vendored tooling; not executed, not declared malware. No `.dll`/`.so` found by full-tree extension scan |
| Review needed — minification/obfuscation | Aztec/Webpack/vendor and CT bundles; compact/encoded protocol payloads | Minification is confirmed; it is not automatically malicious. Editable client build sources are not established |

Search terms included `eval`, `base64_decode`, `gzinflate`, `shell_exec`, `exec`, `system`, `passthru`, `proc_open`, `child_process`, PowerShell, curl/wget, credential/admin markers, wallet-address patterns, remote scripts/iframes/WebSockets and minified code. No active PHP `eval(base64_decode(...))`/`gzinflate` loader, OS download-and-execute chain, PowerShell launcher or `child_process` call was found in the representative first-party cache. Regex `.exec()` and class `System(...)` matches are **not** shell execution. Root Composer lifecycle scripts perform environment copy/key generation/package discovery; no suspicious root postinstall chain was established. Vendored/transitive install scripts were not exhaustively certified.

No confirmed hidden iframe loader or malicious telemetry collector was established. The ordinary full-screen iframes in the sample launchers are visible launch containers. Wallet-like regex candidates in the Book of Nile launchers resolve to embedded base64 loading images, not payment destinations. No confirmed theft wallet or hardcoded crypto destination was identified in the inspected execution paths; payment integration URLs and payment configuration are not by themselves evidence of theft. None of these negative observations certifies unsampled code.

Outbound host findings, read statically and **not contacted**:

| Host | Where / role |
|---|---|
| `betshop.io` | `socket_config.json`, `socket_config2.json`, `arcade_config.json`, `casino/config/app.php:65`; configured casino/socket host |
| `rgs-stage.casino-technology.com` | CT `casino_settings1.min.js:10` default server URL and `second2.min.js:3609` remote UI image |
| `games-qa.isoftbet.com`, `stage-games-lux.isoftbet.com`, `demo.isoftbet.com`, `master-dt.isoftbet.com` | Aztec game bundle line 2; staging/demo/connection settings, not a proven covert control channel |
| `192.168.10.108` | `Dragons888PMM.blade.php:170`; hardcoded private-network reference |
| `api.commerce.coinbase.com`, `sci.interkassa.com` | Explicit payment integration code; unrelated to local slot assets |
| `fonts.googleapis.com`, `www.gravatar.com` | Font/avatar references; potential ordinary outbound requests |
| `www.gstatic.com` | Firebase app/messaging script tags in PGD launchers are inside HTML comments (e.g. `BuffaloPGD.blade.php:60?61`); dormant references, not confirmed active telemetry |
| `registry.npmjs.org` | Lockfile dependency provenance, not runtime telemetry |

Documentation namespaces/domains (`w3.org`, Pixi/CreateJS documentation, etc.) were separated from operational URLs. Dynamically assembled endpoints may not be captured by literal-host scanning. A compromised production instance or remote-control domain was not demonstrated; **HIGH** reflects concrete source risks, not a fabricated malware verdict.

## 10. 1:1 UI likelihood

| Games | Likelihood | Why |
|---|---|---|
| All ten requested sample slots, including the Jumanji substitute | **UNKNOWN** | Game client files absent; only launch intent/protocol/math and thumbnails remain |
| American Gigolo CT | **MEDIUM** | Real game-specific backgrounds/symbol/help/audio/UI code; empty required boot scripts and unresolved paths |
| Aztec Gold Megaways iSoftBet | **MEDIUM** | Real desktop/mobile layouts, Spine assets, bonus/paytable screens and bundled game code; missing symbol sheets, no visual comparison |

No game was marked HIGH based on a matching title. There is no evidence here that the requested ten can be obtained from these trees with their complete provider-like animations and flow already working. The two partial clients show that provider-style material exists in this lineage, but they do not establish a 100-game acquisition path.

## 11. Missing external packs and bounded fork screening

The central missing deliverable is the public `/games/<ID>/` client pack. The absence is demonstrated by full tree enumeration and the launchers' actual references. README links to external distributions do not supply repository files and were not used to count games. No Discord/private pack was obtained or assumed to exist intact; no purchase or signup occurred.

Two additional GitHub candidates were screened only at the tree level to test whether they offered more actual client material:

| Candidate | Pinned tree/commit | Evidence / decision |
|---|---|---|
| [s0bvi/goldsvet-opensource](https://github.com/s0bvi/goldsvet-opensource/tree/531828e804bf81b1472f60311d6d259495ca6174) | `531828e804bf81b1472f60311d6d259495ca6174` | Nontruncated tree, 21,498 files. The 58 game-path JS hits are arcade **server** modules; no larger browser client pack established. Not promoted to full audit |
| [louisbrant/goldsvet-pragmatic](https://github.com/louisbrant/goldsvet-pragmatic/tree/4578bd9abb31a689313ee6ecfef2e11881e718b6) | `4578bd9abb31a689313ee6ecfef2e11881e718b6` | Nontruncated tree, 627 files; no JS/HTML/XHTML/SWF client files under game paths. Not promoted to full audit |

This was a bounded GitHub search/tree screen, not an exhaustive internet survey. Advertising-only results were not pursued. External caches/clones remain under `C:\Users\Admin\orca\research\game-pack-forensics\external\`; none is imported into Fool's Gold.

## 12. Strongest candidate and acceptance decision

**Strongest inspected repository: taxipult/goldsvet, verdict REFERENCE_ONLY.** It offers the largest actual game-specific backend set and the only substantive client remnants in the three starting repositories. It still fails the user's success criterion: **2 incomplete clients, not 100+ complete clients; 0 complete games established**. Promex is also REFERENCE_ONLY because its large backend collection does not include the game clients. Zeusbyte is REJECT for this acquisition objective.

The conclusion is not that all per-game backends must be replaced. It is that these public trees cannot presently eliminate rebuilding/acquiring the frontend catalogue, and their backends require fairness and security remediation before any reuse. No stronger complete public pack was established in the bounded search.

## 13. Recommended next single-game pilot

**AztecGoldMegawaysISB, gated first on completing and auditing its client files.** It has the richest actual client evidence in the audited trees, including desktop/mobile layouts, bonus presentation and a game-specific server. The first pilot deliverable should be an independently reviewable missing-asset/transport reconciliation for this one title, plus confirmation that the source/assets may be used. If the missing symbol sheets cannot be obtained, stop the pilot before integration; do not represent it as playable.

After that prerequisite, a separately authorized isolated pilot could retain its own backend while replacing unfair outcome conditioning/RNG, verifying wallet/auth/settlement/recovery, and comparing actual visual/event flow to an authorized reference. This report does not implement those changes, run the casino, or touch the existing Book/Gates workspaces. For the user's priority Book of Ra specifically, this repository supplies backend reference code, not the missing finished Book client.

## Reproducibility, isolation and limits

Research worktree: `C:\Users\Admin\orca\workspaces\toto\game-pack-forensics`; branch `research/game-pack-forensics`; base `74c841a61245d4851abf6bba5a82a4873b97e313`. Orca setup hooks were skipped. Only this research directory was edited; no merge, deployment, feature-branch change or imported casino source was performed.

`audit_files.py` acquires explicitly selected public files pinned to commit into the external cache. `build_inventory.py` derives counts and per-game records, joins only game/category SQL metadata, and verifies cached source against Git blob IDs. Example, from this worktree:

```powershell
python docs/agent-work/game-pack-forensics/build_inventory.py C:\Users\Admin\orca\research\game-pack-forensics\external docs/agent-work/game-pack-forensics/inventory.json
```

The inventory covers every immediate backend directory, retains the excluded orphan, maps matching launch templates, records client/asset evidence, provider labels and additional arcade modules. It deliberately does not call a C-class backend production-ready or an F-class partial client full source. All cached sources stayed external; report/inventory contain evidence references rather than imported source. No default credentials, keys or SQL account data are reproduced.

One Flash child was selected using the configured `deepseek/deepseek-v4.1-flash` route; its session repeatedly ended before producing deliverables. The child was stopped and Astra completed this bounded static audit, without another worker or model fallback. Static route configuration was verified; upstream inference metadata was unavailable. Final acceptance is based on tree/blob evidence and the actual artifacts, not the worker's interim claims.

Final static validation passed: 2,277 raw directory inventory rows plus six separately recorded unmatched arcade modules across the two backend repositories; all count/class/provider aggregations; ten structured deep-sample records; all 13 required report sections; 55 pinned source links checked against the real trees; and Python script syntax. Cached content verified against Git object IDs: 1,504 taxipult files, 26 promex files and four zeusbyte files. The larger taxipult cache includes all shared launchers. No runtime or visual acceptance test was claimed.
