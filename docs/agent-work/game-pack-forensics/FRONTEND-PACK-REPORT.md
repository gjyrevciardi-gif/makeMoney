# Missing casino frontend packs — static forensic report

Date: 2026-09-26. Research branch: `research/game-pack-forensics`. Continued from `249e2e3`; the accepted backend audit is unchanged. No casino code, dependencies, servers, installers, or downloaded scripts were executed. External evidence remains under `C:\Users\Admin\orca\research\game-pack-forensics\external\frontend-hunt`, outside the project. Only this report and `frontend-inventory.json` are new deliverables.

## 1. Executive conclusion

**Yes: credible sources containing many actual browser clients were found. No: this audit does not establish a single pack of 100+ complete, distinct, locally playable games.**

The strongest direct Goldsvet directory donor is **[heidi-luong1109/game][heidi]**. Its non-truncated tree contains **102 game directories: 101 substantially populated client/asset directories and one JS client missing its game assets**. These are 85 populated title families after conservative suffix normalization, not 101 independently established commercial titles. Desktop/mobile and classic/deluxe variants must not inflate the catalog.

**83 deployment IDs pass the static entry/config/atlas file gate**, corresponding to **71 normalized title families**. These are class A *static client candidates*, not 83 tested games. They contain the local entry template, client code, game configuration, atlas images and audio. The remaining populated clients have known gaps or incomplete dependency verification. **Runtime-verified complete games: 0**, because execution was explicitly excluded. This is an acceptable 20–100-client research result with significant practical value.

The most useful complementary source is **[babyline00/ahmed_bet][baby]**: **38 Pragmatic game IDs**, each with desktop/mobile browser bundles and game resources, including **Sweet Bonanza and Gates of Olympus**. Their animation objects, textures, audio and feature presentation are real files. However, both target games declare missing `MDL_MultiLobby` resources in their boot queue. They are **B, not complete A clients**. This pack is particularly valuable for recovering provider-style presentation, but is not a verified drop-in pack.

**Exact LuckyLadysCharmDX is present. Exact BookOfRaDXGT, SuperHot40EGT, BurningHot20EGT, StarBurstNET, DolphinReefPT and BookOfFortuneAM were not recovered.** Classic Book of Ra, other EGT/Playtech/Amatic games, and two differently rooted Pragmatic targets provide useful substitutes or protocol-family evidence. No local Gonzo's Quest client was established.

The original taxipult/promex/zeusbyte conclusion remains valid for those snapshots. These results concern different repositories; no backend re-audit was performed.

## 2. Counting and classification rules

Counts come from pinned Git trees and selected raw files, never README claims. `asset files` means image/audio/atlas/skeleton files inside the inspected game roots; it excludes lobby thumbnails outside those roots. Audio embedded in JSON is recorded separately. Multiple resolutions, languages, codecs and desktop/mobile directories are files/variants, not extra titles.

Class A here means the **static frontend file gate** passed: rendered Blade entry available; referenced local script files available; game JS, game configuration and audio present; configuration image/JSON paths resolve; relevant atlas JSON parses and referenced atlas images exist. This gate is applied systematically to the 88 CreateJS/Pixi clients in the strongest pack. It does not prove runtime behavior, every server-generated resource list, every browser/language, security, or protocol compatibility. Configurable game-server responses remain necessary. A separately hosted static page alone is insufficient.

Class B means a substantial client with small identified gaps, or **provisional B** where the loader/dependency closure has not been certified; that uncertainty is explicit per game. C covers asset/authoring evidence without a verified browser deliverable; D covers substantial JS without the game asset set; E covers wrappers; F means no relevant frontend deliverable in the inspected scope, including native/server-only projects. F is not an assertion that genuine backend/native source is fraudulent. Security risk is a separate field: a valid client can also merit G/HIGH treatment.

“Complete count” below is the conservative class A count under this static gate. Runtime completeness remains unverified throughout. One suffix (`GTM`, `GT`, `DX`, `CL`, `PTM`, `PT`, `AM`, `EGT`, `KA`) is removed for a secondary family count; this is a deduplication aid, not an authoritative title catalog. No aggregate total adds mirrors together.

## 3. Pack comparison and actual counts

| Source / pinned commit | Actual populated clients in scope | Game-root files / asset files | Complete A, static gate | Classification / verdict |
|---|---:|---:|---:|---|
| heidi-luong1109/game `1eb3234892790d0c4ded54233f369aff176d9d8d` | **101**, plus 1 D | **18,120 / 10,161** | **83** | A83 / B18 / D1; **STRONG_CANDIDATE** for extraction research |
| hotali0106/Canada-Gambling-Website `a368fb328f924c029d2c6e9515bcdda01dd7f49c` | 85 | 15,025 / 8,075 | 79 | Subset mirror; **PARTIAL_CANDIDATE** |
| Webmaster1116/CANADA777-casino-laravel `f2cc94d46f6a30382de33ebddc202d83b2dbba5b` | 4, plus 1 D | 966 / 620 | 0 certified | `public2/games`; **PARTIAL_CANDIDATE** |
| babyline00/ahmed_bet `68c4ab5088867d233ddb0ed268109110231800df` | **38** | **6,766 / 1,289**, plus **288 audio JSON containers** | **0 certified** | B38, closure gaps; **PARTIAL_CANDIDATE** |
| adowning/gooseflowtwo `90b05d32af479a266a4ab414f81e45ef24d3d895` | 3 substantial directories in scoped server-public screen | Server-public: 535 / 98; 6 audio JSON containers | 0 certified | B; other titles often one-file loaders; **PARTIAL_CANDIDATE** |
| adowning/netgame `ef998850e6e8806f3caaa9da4a0ffe861deb070d` | 3 NETGAME payloads | `public/netgame`: 701 / 443 | 0 certified | B; **PARTIAL_CANDIDATE**, not NetEnt |
| ButterToasty/games3 `b83044ef171d13ae5640d0156153dd83c50f43bd` | 1 Gates capture in scoped Pragmatic subtree | 249 / 20; 2 audio JSON containers | 0 | B, captured remote dependencies; **REFERENCE_ONLY** for this target |
| SamT0829/SweetBonanza `8be894bab4901f8a9383e21a20c7857e794bd762` | 1 authoring project, **not a ready client** | 771 / 171 | 0 | C, missing compiled output; **REFERENCE_ONLY** |

The heidi game-root blobs total 2,438,967,274 bytes; the babyline game-root blobs total 5,320,433,015 bytes. These are Git-tree sizes, **not evidence that the entire payload was downloaded or tested**. Acquisition focused on text, manifests and selected visual assets. The complete game directory inventories, sizes, classification, exact entry paths and evidence hashes are in `frontend-inventory.json`.

**Mirror control:** all 15,025 hotali game-file paths and Git blob hashes are identical to heidi. It adds no new payload. Webmaster has 675 identical paths/blobs out of 966 game files; 287 paths are absent from heidi, largely alternate payload files/entries for the same five IDs. Those are not 287 new games.

### Operational pack questions

| Pack | Desktop / mobile | Audio / bonus presentation | Local boot possible | Remote dependencies / Goldsvet match | UI potential / security |
|---|---|---|---|---|---|
| heidi | Desktop code; some explicit `GTM`/`PTM` variants; other clients resize/rotate. EGT mobile initializer absent. | Audio in 101 populated directories; game-specific bonus assets/classes in sampled bonus games. | Plausible for A candidates with Blade rendering and matching protocol; **not run**. | All 102 directory IDs match the accepted Goldsvet catalog. Font services, socket configuration, game endpoints; PT configurable loaders. | HIGH in inspected samples; unknown for unsampled titles. MEDIUM for simple sampled clients; **HIGH pack handling risk** due mixed loaders. |
| hotali | Same client payload as corresponding heidi IDs. | Same assets/audio. | Same limits; not an independent validation. | Exact directory matches; adds no new payload. | Same inherited findings. |
| Webmaster | Four populated directories plus AfricaRunKA; separate `public2` root. | Game assets/audio in populated directories. | Requires correct document root and entry/config investigation. | Same ID family, different root; several alternate file versions. | Promising provider-family evidence; unverified closure, HIGH handling risk. |
| babyline | Both desktop/mobile bundles for 38 IDs. | Local textures, animation data and encoded audio; target feature screens evidenced below. | **Blocked/uncertain as shipped** for sampled targets because declared module missing; PHP and protocol routes also needed. | Symbol IDs such as `vs20fruitsw`, not Goldsvet folder names; `/public/<symbol>/...` and endpoint paths need mapping. | HIGH target presentation potential; **HIGH** entry/config risk. |
| gooseflowtwo | Gates desktop/mobile payload; Sweet payload much thinner. Other launchers mostly remote. | Present for substantial directories; not verified across advertised catalog. | Not established. | Remote staging/API/telemetry URLs and custom bridges; title roots differ. | Useful alternate snapshots; HIGH handling risk. |
| netgame | Three browser payloads; alternate orientation/client assets require closure audit. | Substantial image/audio assets. | Not established. | NETGAME-specific loaders and protocol, not NetEnt XHTML recovery. | UNKNOWN target match; security not fully audited. |
| ButterToasty | Gates **mobile capture** only in examined subtree. | Local mobile bundle/textures/audio containers. | Not established; recorded remote URLs and placeholders. | Pragmatic demo origin, capture layout, telemetry. | HIGH source-family potential, incomplete packaging; HIGH handling risk. |
| SamT0829 | Egret/DragonBones/FairyGUI source, portrait page. | Local resources and animations, audio assets. | **No**, current manifest references 130 missing JS paths. | Missing `photon.js` and `bin-debug` output; remote login/history/CDN services. | MEDIUM remake/source evidence, not proof of exact Pragmatic behavior; HIGH remote coupling. |

## 4. Provider coverage — evidence and attribution limits

The strongest pack contains these actual frontend families:

| Family | Deployment IDs | Evidence / qualification |
|---|---:|---|
| CreateJS/Pixi classic/deluxe family | **88** | Local game classes, `config/engine.json` or `desktop_view.json`, symbol atlases/audio. The accepted platform catalog labels these **69 Novomatic + 19 Greentube**. Those labels are not independent proof that all are original provider games. |
| Playtech | **6**, representing **3 title families** | Age of Egypt, Age of Gods King of Olympus, Age of the Gods God of Storms, each desktop/mobile. `build.properties` declares `game.vendor=Playtech`; GWT platform/game bundles, `.jmm` scenes and provider build metadata are present. |
| Amatic | **5** | Admiral Nelson, All American Poker, All Ways Fruits, All Ways Joker, Bingo. `amarent` loaders plus title-specific canvas bundles, images/audio and configuration. |
| EGT | **2** | Action Money and Age of Troy: EGT logo, `egt-library`, game-specific configurations, desktop initializers, reels and bonus animation code. Catalog also carries overlapping Igtech labels; do not double-count those as new clients. |
| KA Gaming | **1 incomplete** | AfricaRunKA JS exists, but only favicon/loading resources, no substantial game asset/audio set. Excluded from 101 populated clients. |

The visually inspected `LuckyLadysCharmDX/source/RES/GAME.png` and `BookOfRaCL/source/RES/GAME.png` contain recognizable game branding, paytable artwork and **Novomatic marks**. This supports these exact samples beyond the catalog labels. It does not authenticate all 88 titles or establish the provenance/rights of copied assets. In particular, inherited catalog labels can be misleading: `SafariHeat` is labeled Novomatic by that catalog, so the report does **not** present its label as independent provider attribution.

The complementary babyline pack has **38 Pragmatic symbol IDs** supported by matching UHT bootstrap/game data, including `vs20fruitsw` and `vs20olympgate`. **NetEnt: zero recovered local clients.** NETGAME is a different provider and must not be substituted for NetEnt in the count.

## 5. The ten requested targets

| Requested title / Goldsvet ID | Actual result | UI match likelihood |
|---|---|---|
| Book of Ra Deluxe / `BookOfRaDXGT` | Exact directory absent. `BookOfRa` and `BookOfRaCL` are real **classic** clients, not renamed Deluxe. | **UNKNOWN exact Deluxe; HIGH classic substitute** |
| Lucky Lady's Charm / `LuckyLadysCharmDX` | Exact client, local entry/classes/atlases/audio; A static gate. | **HIGH** |
| Sweet Bonanza / `SweetBonanza` | `babyline/public/vs20fruitsw/gs2c` has both clients/resources. Missing declared MultiLobby module; B. | **HIGH** |
| Gates of Olympus / `GatesofOlympus` | `babyline/public/vs20olympgate/gs2c`; real two-layout payload. Missing declared MultiLobby module; B. | **HIGH** |
| 40 Super Hot / `SuperHot40EGT` | Exact client not found. Action Money is EGT-family evidence, not this game. | **UNKNOWN** |
| Burning Hot / `BurningHot20EGT` | Exact client not found. Age of Troy is EGT-family evidence, not this game. | **UNKNOWN** |
| Starburst / `StarBurstNET` | Goldsvet XHTML launch targets and remote NetEnt iframe URLs only; no audited local payload. | **UNKNOWN** |
| Gonzo's Quest | Searches returned backend references, banners and remote-page leads, not a verified local game client. | **UNKNOWN** |
| Dolphin Reef / `DolphinReefPT` | Exact absent. Three other Playtech title families demonstrate the expected `platform.nocache.js` packaging. | **UNKNOWN exact; HIGH Age of Egypt sample** |
| Book of Fortune / `BookOfFortuneAM` | Exact absent. Five Amatic clients demonstrate the expected `amarent` packaging. | **UNKNOWN exact; HIGH Admiral Nelson sample** |

For absent targets, logo/symbols/grid/controls/help/autoplay/bonus/mobile/audio/animation are **not established**. Launcher references do not satisfy any of those checks. Searches are bounded public-index searches, not proof that the files exist nowhere.

### Lucky Lady's Charm Deluxe — exact recovery

Evidence root: [public/games/LuckyLadysCharmDX][lucky]. Entry: `resources/views/frontend/games/list/LuckyLadysCharmDX.blade.php`. **185 files**, including **18 JS, 47 PNG, 22 JSON, 36 MP3 and 36 OGG**.

The Blade page loads local Pixi/CreateJS, `GameReels`, `GameUI`, `GameRules`, `GameLines`, `GameBonus`, `GameGamble`, `Sounds`, `core`, `utils` and `loader`. `loader.js` requests `config/desktop_view.json`. The atlas references resolve in the pinned tree. Visual inspection of GAME/SYM atlases shows the Lady, coin, clover, horseshoe, ladybird, jewelry, crystal-ball scatter, title strip, reel surround, help/paytable art and a free-game-style panel. This is substantial game-specific presentation, not a thumbnail.

`GameReels.js` moves symbols downward (`objArr[i].y += rollSpeed`, line 294), wraps them, animates final stop/bounce phases, and emits stop/teaser events. `Sounds.js` reacts to reel/teaser, autoplay, help, gamble, collection and free-spin events. `GameBonus.js` implements start/retrigger/end presentation based on free-game response fields. The presentation is five reels/three visible rows. `GameUI` and configuration provide controls/autoplay; `GameRules` plus atlas paytable art provide help. Resize code exists; a distinct portrait redesign has not been demonstrated. No tumble/bonus-buy feature is claimed for this client. Exact stop order/timing equivalence requires a later visual pilot.

**Local launch requirements, not executed:** mount this game's files at `/games/LuckyLadysCharmDX/`; render its Blade page with `$game` and `$slot` flags; provide `POST /game/LuckyLadysCharmDX/server?sessionId=...` with the existing client protocol. `InitializeGame()` calls `getSettings` before loading the game. The entry's WebFont callback gates initialization and requests Google font families, so offline font behavior is unresolved even though local font files exist. `utils.js:251–287` retries requests after ten seconds; duplicate-spin safety is not established here. No changes were made.

### Book of Ra — classic substitute, not Deluxe

Evidence: [BookOfRaCL][book], **282 files**: 18 JS, 81 PNG, 56 JSON, 50 MP3, 50 OGG. `BookOfRa` additionally has a separate CreateJS client. Both pass the static gate.

The inspected CL GAME atlas contains the Book of Ra logo, explorer/Egyptian symbols, book scatter, paytable panels and Novomatic mark. Pixi classes include bonus selection/expansion presentation, game-specific symbol animations and gamble. The tree has regular, free-spin, expanded and looping symbol atlas variants (`*_FS`, `*_LONG`, `*_LONG_LOOP`), together with controls, rules and audio. Five-reel classic presentation and expansion/free-game event flows are credible. Desktop resize exists; exact mobile layout and timing are untested. Neither this artwork nor its folder name proves recovery of **Book of Ra Deluxe / BookOfRaDXGT**.

Launch requirements follow the corresponding Blade + `/games/BookOfRaCL/` + `/game/BookOfRaCL/server` protocol. The target Deluxe launcher must not simply be pointed at this different game and reported as an exact match.

### Sweet Bonanza and Gates — actual Pragmatic presentation data

Evidence: [Sweet Bonanza payload][sweet] and [Gates payload][gates]. Sweet: **151 files**; Gates: **196 files**. Each includes `html5Game.php`, desktop/mobile `bootstrap.js`, `build.js`, `client/game.json`, `client/resources.json`, GUI/game/resource chunks, texture PNGs and audio. The bundle contains Pixi-related implementation; packaging is Pragmatic UHT object/resource serialization, not just a generic Pixi slot demo.

Important format detail: `game000.json`, `game001.json`, etc. are **segments of one serialized object**. Individual segments need not parse. Concatenating each ordered group produces valid JSON for both desktop samples. Likewise, `sounds.mp3.json` / `.ogg.json` contain **actual base64 audio**, not merely filenames. An extension-only scan would incorrectly report missing audio.

| Concatenated desktop group | Sweet Bonanza | Gates of Olympus |
|---|---:|---:|
| Game objects | 51 | 104 |
| Game animation clips | 91 | 79 |
| Game audio-clip objects | 134 | 135 |
| Main resource textures | 44 | 96 |
| Main resource Spine objects | 0 | 44 |
| GUI objects / animation clips / audio-clip objects | 28 / 26 / 20 | 28 / 26 / 20 |

These are serialized object counts, **not extra games, standalone images or necessarily unique sound recordings**. Embedded textures supplement external PNGs.

Sweet object labels include six reel containers (`Reel0` through `Reel5`), `Tumbles`, tumble sequencing, `FreeSpins_bkg`, `RandomSymbolMultiplier_Fruits`, symbols and multiplier holders. Gates includes `BuyFeature`, `NoBuyFeature`, tumble/reel/symbol controllers, `MultiplierEffectGO`, additional/free-spin counters, free-spin win/lose windows and related event transitions. Both have desktop/mobile GUI data, controls/autoplay/help structures, game-specific symbols/background/logo resources and sound packages. This supports **HIGH presentation potential**, including cascades, multipliers and bonus screens. The files do not by themselves prove that every bonus transition or geometry/timing matches a particular live provider version. No conventional left-to-right reel-stop claim is substituted for their tumble presentation.

**Concrete blocker:** both bootstraps declare `MDL_MultiLobby`, its MP3 audio JSON and its OGG audio JSON; those files are absent. `ProcessGameInfo()` concatenates `UHT_MODULES_SIZES` into its loading list, so this is not safely dismissible as an unused marketing feature. The clients remain **B**. Other pack titles have varying manifest formats; `vs20doghouse` passes the narrow declared-reference check, but complete texture/resource closure was not certified and it was not promoted to A. `vs20sugarrushx` uses a format the simple manifest check does not cover.

**Local launch requirements, not executed:** PHP rendering of `html5Game.php` with language/currency/user values; correct document-root mapping for `/public/<symbol>/gs2c/...`; matching game-service and settings routes; resolution of the missing declared module. The page computes HTTPS URLs from `location.hostname`, which drops a non-default port. Goldsvet's `/games/SweetBonanza/gs2c/html5Game.html` and `GatesofOlympus` spelling are **not** the delivered roots/entries. Config/path/protocol mapping is required; merely renaming folders is not validated. Preserving each game's existing logic remains compatible with this assessment; no backend replacement is proposed.

### EGT family evidence — Action Money / Age of Troy

[ActionMoneyEGT][action] has **177 files**, game bundle, EGT library/logo, configuration, symbol/background atlases, MP3s, paytable/UI machinery and substantial `BonusAnimation` / `FreespinAnimation` resources. [AgeOfTroyEGT][troy] has **222 files**, including explicit browser state/controllers, reel and win presentation, free-spin intro/outro/retrigger/door animation code, help/UI and sounds. These are actual clients of the expected family, with **HIGH** sample presentation potential.

Both contain `init/init_desktop_cf_test.js` and local script queues. Their launchers also request **`init/init_mobile_cf_test.js`, which is absent**. They remain B. Initializers dynamically add scripts; communication needs `/socket_config.json` and a configured WebSocket protocol. The demo-domain string `mgs-demo.egtmgs.com` is present and requires contextual review before any future launch. No exact 40 Super Hot or Burning Hot assets were found, and these samples must not be counted as those titles.

### Playtech family evidence — Age of Egypt

[AgeOfEgyptPT][egypt] has **130 files**. Its game `build.properties` explicitly declares `game.id=agoeg`, `game.title=Age of Egypt`, `game.vendor=Playtech`, game version `19.5.3.16`, and provider build/dependency metadata. `platform/platform/platform.nocache.js`, a 2.45 MB GWT platform cache, a 2.15 MB game cache, `.jmm` scenes, symbol/blur/animation atlases, separate landscape/portrait backgrounds, free-game and bonus resources, and OGG audio are present. This is strong **HIGH** evidence of real provider-style packaging, not a title-only wrapper.

The Blade entry sets the platform base, game/session query parameters and loads local platform scripts. Local PHP configuration scripts, `/socket_config.json`, a compatible game protocol, and the correct GWT permutation/deferred files are needed. Only some deferred chunks are present; exhaustive code-split closure was not established. Therefore **B provisional, not certified A**. Controls/help/autoplay are in compiled platform/game machinery; exact behavior remains untested. `DolphinReefPT` itself remains missing.

### Amatic family evidence — Admiral Nelson

[AdmiralNelsonAM][admiral] has **251 files**: 4 JS, HTML entry, title-specific image/JSON assets and 61 files each in MP3/OGG/M4A. `amarent/index.html` has the game canvas, slide/rotate/mobile overlays, notification/jurisdiction controls and `webgl-2d.js`; `admiralloader_00456940.js` loads a real title-specific game bundle. Images/audio include game scenes, reel/feature presentation and free-spin sounds. **HIGH** provider-style potential, although full bundle resource closure remains unverified: **B provisional**.

The loader derives a settings filename from query parameter `config`. The empty/default parameter resolves to the shipped `settings__00296940.js`; do not falsely count the concatenated filename fragments as missing standalone scripts. That settings file obtains `/socket_config.json`; the game uses WebSockets. Static hosting can supply the files but cannot substitute for the game protocol. The default index plus the matching config/protocol is the launch path to investigate later. Exact Book of Fortune was not recovered.

## 6. Frontend completeness and missing dependencies

The 88 CreateJS/Pixi deployments were checked from downloaded entry/code/config/atlas text, not inferred from directory names. **83 passed; five were held back:**

| ID | Static issue |
|---|---|
| Attila | `source/RES/GAME.json` contains an image reference resolving to an inconsistent nested path. Image exists elsewhere; actual effect depends on the custom loader's image handling. Conservatively B. |
| Columbus | Zero-byte `source/RES/SCAT.json`. |
| DiamondTrio | Zero-byte `source/RES/SCAT.json`. |
| HatTrick | Zero-byte `source/RES/SCAT.json`. |
| MarkoPolo | Zero-byte `source/RES/SCAT.json`. |

The final static review verified **4,112 downloaded heidi blobs against their pinned Git object hashes**, with no mismatches; this includes the frontend text, three inspected images and root package metadata. The mirror entry hashes also match. The exact missing paths and checks are stored per game. Empty scatter files are not automatically proof of a total boot failure if that asset is unused by the returned settings; they are sufficient to withhold a full-source-completeness claim. A no-gap result also does not prove every conditional resource requested by the game server was exercised.

Other material gaps are the two EGT mobile initializers, the Pragmatic module resources, incompletely verified GWT deferred loading, AfricaRunKA's missing asset set, and SamT0829's missing compilation outputs/framework module. Amatic default settings are present, but arbitrary `config` values can select absent or unsafe paths. These are client packaging/integration findings; no game mechanics, bank logic, RNG, RTP, wallet or backend security was re-audited.

No new external downloadable “full pack” was accepted on a sales claim. Git LFS or a binary installer was not used to conceal missing source in the counted samples. No `.exe`, `.dll`, `.so` or `.wasm` files occur in the inspected heidi or babyline game roots. Compiled/minified JS is present; that is browser runtime source, not necessarily editable original TypeScript/Java projects.

## 7. Security findings — static only

**Pack handling risk: HIGH. This is not a finding that every game is malware.** Risk follows concrete loader and configuration behavior; no suspicious code was run.

| Finding | Exact evidence | Implication |
|---|---|---|
| Reflected input in executable JS | babyline `public/vs20fruitsw/gs2c/html5Game.php:1365` and Gates equivalent directly echo `$_GET['user']`, `cur`, `lang` inside JavaScript strings without visible encoding at the sink. | HIGH injection concern; a frontend entry must not be exposed as-is. No exploit was executed. |
| Configurable script injection | Admiral `amarent/src/admiralloader_00456940.js:14–36` uses `document.write` to load a path containing the `config` query value. | Constrain/escape configuration before a pilot; inspect origin/path behavior. This is real dynamic script loading, not proof of a remote backdoor. |
| Eval on configured data | Age of Egypt `platform/js/script.js:112` evaluates `gadgetstr`; GWT caches expose `installCode` with `eval`. | Distinguish standard compiled-code loading from externally supplied gadget content; source trust/closure must be established. |
| Outbound font loader | Lucky/Book entry configures WebFont Google families; library includes additional provider support. | Network dependency and potential initialization stall offline. A domain in library support code is not proof it is contacted. |
| Dynamic EGT load queues | `init/init_desktop_cf_test.js` creates `<script>` elements using configured sources. | Local dependencies exist for sampled queues; source and socket configuration still need control. |
| Protocol endpoints | Lucky `js/utils.js:38,287`; Amatic settings/game; EGT and PT launch/config scripts. | HTTP/WebSocket endpoints are required for state. Their existence is not a backend quality assessment. |
| Legacy/provider staging remnants | `mgs-demo.egtmgs.com`, `cashier1.mobdev2.ukraine.ptec`, `studio.game-service.biz`, private `192.168.10.108`; provider build/SVN/intranet strings. | Contextual review needed. Documentation/build strings are not automatically active outbound traffic or control domains. |
| Alternate-capture remote coupling | gooseflowtwo samples reference `test1.pilot6.pragmaticplay.net`, `api.cashflowcasino.com`, Google Tag Manager and local/studio URLs. | Capturing frontend files does not remove remote API/telemetry dependencies. |
| Authoring sample telemetry | Sam `CDNConfig.json` / entry reference djmusic services, staging host and IP/geolocation services. | Not an offline standalone Sweet Bonanza deliverable. |
| Error suppression / message trust | Amatic Blade disables console/error visibility; several launchers accept `CloseGame` messages without origin checks and post with `*`. | Hides errors or allows unwanted navigation; review before embedding. |
| Package metadata | heidi root `package.json` has Laravel Mix build hooks, no root postinstall observed; babyline has no root `package.json`. gooseflowtwo root manifest embeds a database credential in `test:integration` and includes destructive cleanup/reinstall commands. | Credential value redacted; no hooks executed. This is host-package metadata, not a backend code audit. Dependency-level hooks remain unreviewed. |
| Automatic request retry | Lucky `utils.js:251–287` resends after timeout. | Client-level retry is observed; no idempotency safety is inferred. |

Searches included eval/dynamic function construction, script injection, hardcoded HTTP/WebSocket origins, remote bootstrap paths, missing scripts, minified/obfuscated bundles, package hooks and native binary paths within the frontend scope. Minified libraries commonly contain dynamic code machinery; a token match alone was not called malicious. No installer/postinstall was run. Runtime networking, all dependency supply chains and every compiled bundle were **not** exhaustively audited. No clean bill of health is implied for unsampled files or the host casino repository. Sensitive session/config values were not copied into the report/inventory.

## 8. Additional repository and archive screens

Twenty source candidates were assessed at differing depths: 18 GitHub repositories and two GitLab projects. “Audited” here includes explicit tree-level rejection screens, not twenty full security audits. All GitHub candidates have pinned commits in the JSON inventory.

| Candidate | Actual-file result | Class / disposition |
|---|---|---|
| promexdottme/goldsvet-casino-source-code | 23,944 repository files, but no supplied `public/games` payload. | F frontend scope; reject as missing-client source. |
| techiethemastermind/laravel-bet | 15,205 files; matching Blade references without game payload. | F frontend scope; reject. |
| gabipricop99/casino-canada777- | Whole recursive tree **truncated**; inspected portion has no established client root. | F observed frontend evidence; **total unknown**, zero verified. Do not treat partial enumeration as proof of absence. |
| promexdotme/laravel-social-gaming | 12,014 files; wrapper/bridge references without requested game payload. | E; reject. |
| wizesgms/games_cd | 4,729 files, provider server directories and session/API HTML, not a recovered browser pack. | F frontend scope; no backend audit. |
| weinviaje/sweetbonanza | Unity project/assets; template includes a differently named Mahjong Ways 2 loader. | C; authoring/reference only, no Sweet browser build established. |
| ywvv/GatesOfOlympus | Android/Gradle project. | F requested browser scope. |
| Arcrun-am/gatesOfOlympus | Small TypeScript remake; numerous empty audio/engine/component files. | B source candidate with gaps, LOW exact-provider confidence. |
| Nandini319/GatesOfOlympus-Fixed-2 | Swift/Xcode project. | F requested browser scope. |
| enhuizhu/casino-prototype | `server/html.js` supplies remote `comeon-static-test.casinomodule.com` iframe URLs, including Starburst. | E; no local NetEnt client. |
| GitLab `mintscripts/goldsvet-7-5-casino-script-php-html5-games-open-source`, project 84893462 | Recursive tree contains **README.md only**. | F; reject. |
| GitLab `mintscripts_studio/goldsvet-casino-open-source-engine-public`, project 86771436 | Six files: `CasinoCore.php`, `CryptoGateway.php`, `GoldsvetCasino.jpg`, `README.md`, `composer.json`, `llms.txt`; no clients. | F; reject. |

Public archive search: Internet Archive `goldsvet` returned one video item (`youtube-qCmG2GK3c90`), not a source pack. A broader casino/HTML5 software query returned noisy native/software/marketing results; no source archive was promoted without inspecting a credible file payload. Public mirror/forum leads advertising external packs were not treated as source evidence. GitHub code searches used the ten IDs and concrete loader/protocol strings, including `init_desktop_cf_test.js`, `webgl-2d.js`, `platform.nocache.js`, `vs20fruitsw`, `vs20olympgate`, NetEnt XHTML and Gonzo spellings. No archive installer or remote downloader was run.

## 9. Strongest candidate and recommended single-game pilot

**Strongest direct directory donor: heidi-luong1109/game.** It demonstrates that the missing Goldsvet frontend family is publicly represented by actual per-game JS, atlases, audio, configuration and presentation flows. It could supply a substantial subset of `/games`, subject to per-game verification. It does not supply the full 1,184-game catalog, all six target providers, or 100 verified distinct titles.

**Recommended next single-game pilot: `LuckyLadysCharmDX` from the pinned heidi commit.** It matches an existing Goldsvet ID exactly, passes the static file gate, has visually inspected provider-style atlases, and exposes readable game-specific frontend classes for reels, bonuses, rules, gamble and sounds. It is a smaller and clearer pilot than a compiled platform client or a Pragmatic client with a known missing boot module.

The later pilot should establish local asset loading and the font/init dependency, then observe reel/stop/win/free-game/gamble presentation against controlled responses from its corresponding existing game logic. It should determine protocol compatibility and exact UI/timing rather than assume them. No pilot, server start, game fix, code import or architectural redesign was performed in this research task.

**Success assessment:** useful many-client sources found; exact provider-style recovery demonstrated for Lucky Lady and strongly evidenced for Sweet/Gates presentation. The claim “100+ complete local games recovered” remains unsupported. Stop at this report.

[heidi]: https://github.com/heidi-luong1109/game/tree/1eb3234892790d0c4ded54233f369aff176d9d8d/public/games
[baby]: https://github.com/babyline00/ahmed_bet/tree/68c4ab5088867d233ddb0ed268109110231800df/public
[lucky]: https://github.com/heidi-luong1109/game/tree/1eb3234892790d0c4ded54233f369aff176d9d8d/public/games/LuckyLadysCharmDX
[book]: https://github.com/heidi-luong1109/game/tree/1eb3234892790d0c4ded54233f369aff176d9d8d/public/games/BookOfRaCL
[sweet]: https://github.com/babyline00/ahmed_bet/tree/68c4ab5088867d233ddb0ed268109110231800df/public/vs20fruitsw/gs2c
[gates]: https://github.com/babyline00/ahmed_bet/tree/68c4ab5088867d233ddb0ed268109110231800df/public/vs20olympgate/gs2c
[action]: https://github.com/heidi-luong1109/game/tree/1eb3234892790d0c4ded54233f369aff176d9d8d/public/games/ActionMoneyEGT
[troy]: https://github.com/heidi-luong1109/game/tree/1eb3234892790d0c4ded54233f369aff176d9d8d/public/games/AgeOfTroyEGT
[egypt]: https://github.com/heidi-luong1109/game/tree/1eb3234892790d0c4ded54233f369aff176d9d8d/public/games/AgeOfEgyptPT
[admiral]: https://github.com/heidi-luong1109/game/tree/1eb3234892790d0c4ded54233f369aff176d9d8d/public/games/AdmiralNelsonAM
