/** Original presentation artwork and measured cabinet geometry; no game rules. */
export interface SymbolImagePresentation {
  src: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  crop?: { x: number; y: number; width: number; height: number };
}

/** One colour per configured payline, shared by the rail chips and the 02 overlay. */
export const bookPaylineColors: readonly string[] = [
  "#f5e04a", "#e8574f", "#a9d8f0", "#9ede5a", "#6fa8f5",
  "#f7b0a8", "#f5c98a", "#7ed957", "#f2a8d0", "#c9a8f0",
];

/** Rail chip step, shared by the chip drawing and the 02 line endpoints. */
export const bookChipStep = (count: number): number => Math.min(48.5, 478 / Math.max(1, count));

/**
 * Centre of the payline chip for `index` on a rail, in the 1255x630 canvas space.
 * Lines that terminate here read as integrated with the marker rails (reference 02).
 */
export function bookRailChipCentre(index: number, count: number, side: "left" | "right"): { x: number; y: number } {
  const x = side === "left" ? 34 : 1018;
  return { x: 66 + (x + 24) * (1127 / 1112), y: 144 + index * bookChipStep(count) + 19.5 };
}

export interface BookBox { x: number; y: number; width: number; height: number; }

/** Paytable presentation models, assembled from the game's own paytable config. */
export interface BookPaytableEntry { count: number; value: string; }
export interface BookPaytableCard {
  symbolIds: readonly string[];
  names: readonly string[];
  basis: string;
  entries: readonly BookPaytableEntry[];
}

export const bookStyles = `
:host([presentation="classic"]) {container-type:inline-size;font-family:Arial,sans-serif;width:100%}
:host([presentation="classic"]) .game.immersive {width:100%;height:auto;margin:0;background:#000;color:#fff;overflow:hidden}
:host([presentation="classic"]) .feature-strip,
:host([presentation="classic"]) .extras {display:none}
:host([presentation="classic"]) .bonus {background:rgba(0,0,0,.72);backdrop-filter:none}
:host([presentation="classic"]) .bonus-panel {width:min(760px,88%);padding:24px 28px;border:4px ridge #e7b545;border-radius:4px;background:linear-gradient(180deg,#6d2807,#2a0f05 72%,#120804);box-shadow:0 0 0 3px #301305,0 14px 42px #000;transform:translateY(10px) scale(.96)}
:host([presentation="classic"]) .bonus.active .bonus-panel {transform:none}
:host([presentation="classic"]) .bonus-panel h3 {font:700 clamp(22px,3.2cqw,42px)/1 Georgia,serif;color:#ffe66c;text-shadow:2px 2px #180600;letter-spacing:.04em}
:host([presentation="classic"]) .bonus-panel p {color:#fff1bf;font:700 clamp(12px,1.4cqw,19px)/1.2 Arial,sans-serif;letter-spacing:.04em}
:host([presentation="classic"]) .gamble-row {gap:clamp(18px,4cqw,44px);margin-top:18px}
:host([presentation="classic"]) .gamble-row .bonus-choice {min-width:clamp(130px,22cqw,240px);height:clamp(54px,8cqw,90px);border:5px ridge #b7b7b7;border-radius:50%;font:bold clamp(18px,2.4cqw,32px) Georgia,serif;text-transform:none;box-shadow:inset 0 8px 10px #fff8,inset 0 -10px 12px #000a,0 4px 0 #190b04}
:host([presentation="classic"]) .gamble-row .bonus-choice[data-style="red"] {background:linear-gradient(#ff9b9b 0 30%,#e22929 48%,#6d0505 100%);color:#fff}
:host([presentation="classic"]) .gamble-row .bonus-choice[data-style="black"] {background:linear-gradient(#d8d8d8 0 30%,#555 48%,#050505 100%);color:#fff}
:host([presentation="classic"]) .gamble-row .bonus-choice[data-style="gold"] {background:linear-gradient(#fff4b0,#d48f19 55%,#573006);color:#1b0d02}
:host([presentation="classic"]) .announce {border:4px ridge #e4b54a;border-radius:4px;background:linear-gradient(180deg,#f4d57b,#88420e 70%,#341507);box-shadow:0 0 0 3px #260d04,0 12px 36px #000;color:#fff}
:host([presentation="classic"]) .announce h3 {font-family:Georgia,serif;color:#fff4a9;text-shadow:2px 2px #3b1203}
:host([presentation="classic"]) dialog {width:min(820px,88%);max-height:80%;border:5px ridge #d9a631;border-radius:3px;padding:18px;background:linear-gradient(135deg,#e3c879,#76602c 55%,#d7be6c);color:#1a1005;box-shadow:0 0 0 3px #2d1405,0 18px 60px #000}
:host([presentation="classic"]) dialog::backdrop {background:rgba(0,0,0,.8)}
:host([presentation="classic"]) dialog h2 {font:700 clamp(22px,3cqw,38px) Georgia,serif;text-align:center;color:#3b1a05;text-shadow:1px 1px #fff2a4}
:host([presentation="classic"]) dialog table {width:100%;border-collapse:collapse;background:#170b05;color:#ffe36a;font:700 clamp(12px,1.4cqw,18px) Arial,sans-serif}
:host([presentation="classic"]) dialog th,:host([presentation="classic"]) dialog td {padding:8px;border:2px solid #8e6418;text-align:center}
:host([presentation="classic"]) dialog th {background:#552006;color:#fff1a5}
:host([presentation="classic"]) dialog .close {float:right;border:2px solid #7b4b12;background:#d7a72f;color:#211000;font:bold 22px Arial;cursor:pointer}
:host([presentation="classic"]) .game.immersive .stage {border-radius:0}
:host([presentation="classic"]) .game.immersive canvas.reel-canvas {aspect-ratio:1112/625}
:host([presentation="classic"]) .game.immersive .console.cabinet {position:relative;height:11.7cqw;margin:0;border:0;border-top:.35cqw solid #eead24;background:radial-gradient(ellipse at 48% -35%,#d05c16 0,#833110 65%,#39190c 100%);box-shadow:inset 0 .35cqw .4cqw #3b1a07}
:host([presentation="classic"]) .cab-message {position:absolute;left:9.35%;top:.65cqw;width:70.65%;height:5.9cqw;display:flex;align-items:center;justify-content:center;border:.25cqw solid #9d7b58;border-radius:1cqw;background:linear-gradient(#141518,#303033 55%,#171719);box-shadow:inset 0 0 .5cqw #000;font:bold 2.8cqw/1 Arial,sans-serif;color:#ffee42;letter-spacing:.06cqw}
:host([presentation="classic"]) .cab-meters {position:absolute;left:9.35%;top:6.95cqw;width:46%;height:5.7cqw;display:grid;grid-template-columns:1.15fr 1.05fr 1.35fr .88fr;gap:.7cqw;padding:0;border:0;border-radius:0;background:none;box-shadow:none}
:host([presentation="classic"]) .cab-meter {padding:0;border:0;background:none;box-shadow:none;overflow:visible}
:host([presentation="classic"]) .cab-meter small {height:1.4cqw;border:.14cqw solid #77624a;border-radius:.4cqw;background:linear-gradient(#232526,#414142);color:#eee;font:bold 1.1cqw/1.2 Arial,sans-serif;letter-spacing:0;text-transform:none}
:host([presentation="classic"]) .cab-meter strong {margin-top:.55cqw;height:3.4cqw;border:.3cqw ridge #aaa19a;border-radius:.6cqw;background:linear-gradient(#080606,#17110d);color:#ffee42;font:bold 2.25cqw/2.8cqw Arial,sans-serif;text-shadow:.1cqw .1cqw #443800}
:host([presentation="classic"]) .cab-meter {position:relative}
:host([presentation="classic"]) .cab-meter:nth-child(2) small,:host([presentation="classic"]) .cab-meter:nth-child(3) small {width:75%;margin:auto}
:host([presentation="classic"]) .cab-meter:nth-child(2) strong {width:36%;margin-left:32%}
:host([presentation="classic"]) .cab-meter:nth-child(3) strong {width:58%;margin-left:21%}
:host([presentation="classic"]) .meter-adjust {position:absolute;top:1.95cqw;width:26%;height:3.4cqw;padding:0;border:.3cqw ridge #a3a09b;border-radius:.45cqw;background:linear-gradient(#dadbd4,#8b8c86);color:#5b5d53;font:bold 2.3cqw Arial,sans-serif;opacity:1}
:host([presentation="classic"]) .meter-adjust:first-of-type {left:0}
:host([presentation="classic"]) .meter-adjust:last-of-type {right:0}
:host([presentation="classic"]) .cab-meter:nth-child(2) .meter-adjust:first-of-type,:host([presentation="classic"]) .cab-meter:nth-child(3) .meter-adjust:last-of-type {background:linear-gradient(#d0ffa5,#5ee036 50%,#339817);color:#145204}
:host([presentation="classic"]) .cab-meter:nth-child(3) .meter-adjust {width:19%}
:host([presentation="classic"]) .cab-meter.win-total {position:absolute;left:133%;top:-2.2cqw;width:17%;height:1cqw;display:flex;align-items:center;gap:.3cqw;opacity:.65}
:host([presentation="classic"]) .cab-meter.win-total small {background:none;border:0;font-size:.8cqw}
:host([presentation="classic"]) .cab-meter.win-total output {font:bold .9cqw Arial,sans-serif;color:#ffee42}
:host([presentation="classic"]) .cab-deck {display:contents}
:host([presentation="classic"]) .cab-key,:host([presentation="classic"]) .spin.cab-start {position:absolute;margin:0;min-width:0;padding:0;border:.36cqw ridge #c0b294;border-radius:.65cqw;text-transform:none;letter-spacing:0;font:bold 2cqw/1 Arial,sans-serif;text-shadow:.13cqw .13cqw #000;color:#fff;box-shadow:inset 0 .5cqw .45cqw #fff7,inset 0 -.5cqw .55cqw #0009;cursor:pointer}
:host([presentation="classic"]) .cab-key[data-key="autoplay"] {left:80.7%;top:.65cqw;width:12.35%;height:6.4cqw;background:linear-gradient(#deffc5 0,#8af236 25%,#3cbd04 48%,#087900 100%);color:#071900;text-shadow:0 .1cqw #aeed7d}
:host([presentation="classic"]) .cab-key.paytable {left:56.15%;top:6.1cqw;width:12.05%;height:3.2cqw;background:linear-gradient(#c0eaff,#2b8ef8 42%,#065daf 55%,#83c4f0)}
:host([presentation="classic"]) .cab-key[data-key="gamble"] {left:68.4%;top:6.1cqw;width:12%;height:3.2cqw;background:linear-gradient(#eee,#969696);color:#646464;text-shadow:0 .1cqw #eee;opacity:1}
:host([presentation="classic"]) .spin.cab-start {left:80.7%;top:6.1cqw;width:12.35%;height:3.2cqw;background:linear-gradient(#e8ffd9,#72ef2c 35%,#168f00 60%,#51d613);color:#082700;text-shadow:0 .1cqw #bdff8f}
:host([presentation="classic"]) .spin.cab-start:disabled {opacity:1;filter:none;cursor:default}
:host([presentation="classic"]) .cab-key:disabled {cursor:default;opacity:1;filter:none}
:host([presentation="classic"]) .spin.cab-start {display:flex;align-items:center;justify-content:center;gap:.55cqw}
:host([presentation="classic"]) .spin-icon {width:2.1cqw;height:2.1cqw;flex:none}
:host([presentation="classic"][reels-moving]) .spin-icon {animation:book-spin 1s linear infinite}
:host([presentation="classic"][reels-moving]) .win-message {opacity:0!important;transition:none}
:host([presentation="classic"][gamble-active]) .spin-icon {display:none}
@keyframes book-spin {to{transform:rotate(360deg)}}
/* Gamble replaces the reel window, with cabinet and lower controls preserved. */
:host([presentation="classic"]) .bonus.gamble-screen {inset:16.83% 6.74% 1.27% 8.72%;background:none;align-items:stretch}
:host([presentation="classic"]) .gamble-screen .bonus-panel {position:relative;width:100%;height:100%;padding:0;border:.55cqw ridge #ae6931;border-radius:2.5cqw;box-sizing:border-box;overflow:hidden;box-shadow:inset 0 0 0 .2cqw #f7c671;background:radial-gradient(ellipse at 69% 15%,#fff69e 0,#ffc34a 30%,#ed8a15 58%,#b12800 100%);transform:none}
:host([presentation="classic"]) .gamble-amount {position:absolute;left:3%;top:3%;color:#fff;font:bold 1.9cqw/1.4 Arial,sans-serif;text-shadow:.1cqw .1cqw #966622}
:host([presentation="classic"]) .gamble-amount output {display:block;color:#fff279;font-size:1.9cqw}
:host([presentation="classic"]) .gamble-history {position:absolute;left:19%;right:3%;top:18%;height:18%;display:flex;gap:3%;align-items:center;color:#fff;font:bold 1.65cqw Arial,sans-serif;text-shadow:.1cqw .1cqw #92651d}
:host([presentation="classic"]) .gamble-history>strong {width:38%;white-space:nowrap}
:host([presentation="classic"]) .gamble-history>div {display:flex;gap:.8cqw;flex:1;height:100%}
:host([presentation="classic"]) .card-back {display:block;box-sizing:border-box;border:.45cqw ridge #e8e7dd;background-color:#d76b85;background-image:repeating-conic-gradient(#fff5 0 25%,transparent 0 50%);background-size:4px 4px;box-shadow:0 0 0 .1cqw #8b5837,inset 0 0 0 .15cqw #fff8}
:host([presentation="classic"]) .gamble-history .card-back {flex:1}
:host([presentation="classic"]) .gamble-card {position:absolute;left:42.5%;top:44%;width:17%;height:44%;border-width:1cqw;border-radius:.5cqw;background-color:#2846a1;background-size:3px 3px}
:host([presentation="classic"]) .gamble-screen .gamble-row {position:absolute;inset:51% 7% 15%;display:flex;justify-content:space-between;margin:0;gap:0}
:host([presentation="classic"]) .gamble-screen .bonus-choice {width:30%;min-width:0;height:100%;border:.4cqw ridge #bdbdbd;font:bold 2.3cqw Arial,sans-serif;padding:0;letter-spacing:0;color:#111;text-shadow:0 .1cqw #fff9;background:linear-gradient(#f8f8f8,#dfdfdf 18%,#8a8a8a 34%,#e2e2e2 37%,#aaa 62%,#222 65%,#050505 95%);box-shadow:0 .2cqw .2cqw #4c220e,inset 0 0 0 .35cqw #202020}
:host([presentation="classic"]) .gamble-screen .bonus-choice[data-style="red"] {color:#b60000;background:linear-gradient(#ffe9e9,#fc8d8d 18%,#e50b0b 34%,#e2e2e2 37%,#aaa 62%,#d60000 65%,#6e0000 95%)}
:host([presentation="classic"]) .gamble-screen .bonus-choice[data-style="black"] {color:#111;background:linear-gradient(#f8f8f8,#aaa 18%,#333 34%,#e2e2e2 37%,#aaa 62%,#151515 65%,#000 95%)}
:host([presentation="classic"]) .gamble-screen .gamble-hint {position:absolute;bottom:2%;left:2%;right:2%;margin:0;font:1.3cqw Arial,sans-serif;letter-spacing:0;text-transform:none;color:#fff;text-shadow:1px 1px #632405}
:host([presentation="classic"][reference-state="06-gamble"]) .bonus.gamble-screen {left:18.895%;right:17.365%}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-screen .bonus-choice {font-size:1.85cqw}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-amount,:host([presentation="classic"][reference-state="06-gamble"]) .gamble-amount output {font-size:1.6cqw}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-history {font-size:1.6cqw}
:host([presentation="classic"][reference-state="06-gamble"]) .gamble-screen .gamble-hint {font-size:1.05cqw}
@media(prefers-reduced-motion:reduce){:host([presentation="classic"]) .spin-icon{animation:none!important}}
@media(min-width:601px) {
 :host([presentation="classic"][reference-state="06-gamble"]) .game.immersive canvas.reel-canvas {aspect-ratio:1/.423}
 /* Landscape cabinet, measured against the 1255x761 approved base capture.
    The canvas is the full cabinet face: 1255 wide (native capture width) by the
    630-unit frame height, so the lower control band is the capture's remaining
    131/1255 = 10.44cqw. 1cqw equals 1% of cabinet width because container
    queries only expose inline size. */
 :host([presentation="classic"]) .game.immersive canvas.reel-canvas {aspect-ratio:1/.502}
 /* Control band: the reference's y 630..761 strip below the frame. */
 :host([presentation="classic"]) .game.immersive .console.cabinet {position:relative;height:10.44cqw;margin:0;border:0;background:linear-gradient(#7a3210,#8f3d12 40%,#54230c);box-shadow:inset 0 0 0 .3cqw #b4731c,inset 0 .5cqw .7cqw #2a0f05,inset 0 -.4cqw .6cqw #230d04}
 /* Every control sits on the reference's single row: measured capture y 660..729
    is 2.39..7.89cqw inside the band. */
 :host([presentation="classic"]) .cab-message {left:37.3%;top:2.39cqw;width:25.7%;height:5.5cqw;border-width:.16cqw;border-radius:.5cqw;font:bold 1.12cqw/1 Arial,sans-serif;letter-spacing:.02cqw;text-transform:uppercase}
 :host([presentation="classic"]) .cab-meters {left:20.1%;top:2.39cqw;width:16.2%;height:5.5cqw;grid-template-columns:repeat(4,minmax(0,1fr));gap:.3cqw;border-width:.16cqw;border-radius:.5cqw}
 :host([presentation="classic"]) .cab-meter {padding:0 .25cqw;border-radius:.35cqw}
 :host([presentation="classic"]) .cab-meter small {height:.95cqw;border-width:.06cqw;border-radius:.25cqw;font:bold .6cqw/.95cqw Arial,sans-serif;letter-spacing:0;text-transform:none}
 :host([presentation="classic"]) .cab-meter strong {margin-top:.2cqw;height:2.5cqw;border-width:.08cqw;border-radius:.25cqw;font:bold .95cqw/2.4cqw Arial,sans-serif;text-shadow:none}
 :host([presentation="classic"]) .cab-meter:first-child small,:host([presentation="classic"]) .cab-meter:nth-child(4) small {width:100%;margin:auto}
 :host([presentation="classic"]) .meter-adjust {top:1.35cqw;width:.9cqw;height:2.5cqw;border-width:.08cqw;border-radius:.25cqw;font:bold .8cqw/2.4cqw Arial,sans-serif}
 /* The reference shows the plus/minus affordances beside a single meter, not every cell. */
 :host([presentation="classic"]) .cab-meter:nth-child(2) .meter-adjust {display:none}
 :host([presentation="classic"]) .cab-meter:nth-child(3) strong {width:44%;margin-left:28%;font-size:.8cqw}
 /* Win total sits under the bet panel, mirroring the capture's credits line. */
 :host([presentation="classic"]) .cab-meter.win-total {left:147.5%;right:auto;top:3.81cqw;width:98%;height:1.2cqw;gap:.3cqw;justify-content:center}
 :host([presentation="classic"]) .cab-meter.win-total small {background:none;border:0;font-size:.6cqw}
 :host([presentation="classic"]) .cab-meter.win-total output {font:bold .8cqw Arial,sans-serif;color:#fff279}
 /* Control row on the measured x positions: MENU 13.4%, meters 20.1%..36.3%,
    bet panel 37.3%..63%, then the four right-hand keys finishing on the
    reference's 86.9% right edge. */
 :host([presentation="classic"]) .cab-key[data-key="menu"] {left:13.4%;top:2.39cqw;width:5.7%;height:5.5cqw;font-size:.9cqw;background:linear-gradient(#c9c6b6,#8d8a7c 45%,#5c5a50)}
 :host([presentation="classic"]) .cab-key.paytable {left:63.6%;top:2.39cqw;width:4.4%;height:5.5cqw;font-size:.72cqw;background:linear-gradient(#f2e6c8,#c99a52 45%,#8a5a1c)}
 :host([presentation="classic"]) .cab-key[data-key="gamble"] {left:68.5%;top:2.39cqw;width:4.4%;height:5.5cqw;font-size:.72cqw}
 :host([presentation="classic"]) .cab-key[data-key="autoplay"] {left:73.4%;top:2.39cqw;width:4.4%;height:5.5cqw;font-size:.72cqw}
 :host([presentation="classic"]) .spin.cab-start {left:78.3%;top:2.39cqw;width:8.6%;min-width:0;height:5.5cqw;font-size:1.05cqw}
 :host([presentation="classic"]) .spin-icon {width:1.5cqw;height:1.5cqw}
 /* Real help state: the cabinet paints the symbol/pay cards in the reel window, so
    the dialog keeps its accessible table as off-screen text and shrinks to its
    close key. Close and Esc still end the help state. */
 :host([presentation="classic"][help-open]) dialog {position:fixed;top:1%;right:1%;left:auto;width:auto;max-width:none;max-height:none;padding:0;border:0;background:none;box-shadow:none}
 :host([presentation="classic"][help-open]) dialog::backdrop {background:transparent}
 :host([presentation="classic"][help-open]) dialog h2,
 :host([presentation="classic"][help-open]) dialog table {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
 :host([presentation="classic"][help-open]) dialog .close {position:static;float:none}
 }
@media(max-width:600px) {
 :host([presentation="classic"]) .spin-icon {width:4.5cqw;height:4.5cqw}
 :host([presentation="classic"]) .gamble-amount,:host([presentation="classic"]) .gamble-amount output {font-size:3.1cqw}
 :host([presentation="classic"]) .gamble-history {left:5%;font-size:2.45cqw}
 :host([presentation="classic"]) .gamble-history>strong {white-space:normal;width:30%}
 :host([presentation="classic"]) .gamble-screen .bonus-choice {font-size:4cqw}
 :host([presentation="classic"]) .gamble-screen .gamble-hint {font-size:2.25cqw}
 :host([presentation="classic"]) .game.immersive canvas.reel-canvas {aspect-ratio:1/.78}
 :host([presentation="classic"]) .game.immersive .console.cabinet {height:48cqw;border-top-width:.8cqw}
 :host([presentation="classic"]) .cab-message {left:3%;width:94%;top:2cqw;height:9cqw;font-size:4.3cqw;border-width:.5cqw}
 :host([presentation="classic"]) .cab-meters {left:3%;top:13cqw;width:94%;height:12cqw;gap:1.2cqw;grid-template-columns:1.12fr .8fr 1.05fr 1fr}
 :host([presentation="classic"]) .cab-meter small {font-size:2.3cqw;height:3.4cqw;border-width:.3cqw}
 :host([presentation="classic"]) .cab-meter strong {font-size:4.5cqw;height:7cqw;line-height:6cqw;margin-top:.7cqw;border-width:.6cqw}
 :host([presentation="classic"]) .cab-meter:nth-child(2) strong,:host([presentation="classic"]) .cab-meter:nth-child(3) strong {width:100%;margin-left:0}
 :host([presentation="classic"]) .cab-meter:nth-child(2) small,:host([presentation="classic"]) .cab-meter:nth-child(3) small {width:100%}
 :host([presentation="classic"]) .meter-adjust {display:none}
 :host([presentation="classic"]) .cab-meter.win-total {left:35%;top:28.5cqw;width:30%;justify-content:center;opacity:1;gap:1cqw}
 :host([presentation="classic"]) .cab-meter.win-total small,:host([presentation="classic"]) .cab-meter.win-total output {font-size:2.6cqw}
 :host([presentation="classic"]) .cab-key,:host([presentation="classic"]) .spin.cab-start {top:27cqw!important;height:12cqw!important;border-width:.7cqw;border-radius:1cqw;font-size:3.15cqw}
 :host([presentation="classic"]) .cab-key[data-key="autoplay"] {left:3%;width:22%}
 :host([presentation="classic"]) .cab-key.paytable {left:27%;width:22%}
 :host([presentation="classic"]) .cab-key[data-key="gamble"] {left:51%;width:22%}
 :host([presentation="classic"]) .spin.cab-start {left:75%;width:22%}
}
`;

const gold = (ctx: CanvasRenderingContext2D, x: number, width: number) => {
  const g = ctx.createLinearGradient(x, 0, x + width, 0);
  for (const [offset, color] of [[0, '#493008'], [.12, '#926016'], [.28, '#d89508'], [.42, '#ffe374'], [.52, '#a16a0a'], [.7, '#e3ad29'], [.88, '#795018'], [1, '#36200b']] as const) g.addColorStop(offset, color);
  return g;
};

export function drawBookCabinet(ctx: CanvasRenderingContext2D, width: number, height: number, overlay: boolean, referenceState = "", titleImage?: HTMLImageElement, paylineCount = 0): void {
  // The canvas is the whole 1255-wide cabinet face; the frame itself measures
  // x 66..1193, y 0..630 of the approved 1255x761 base capture, so the cabinet
  // artwork keeps its original 1112-unit layout mapped onto that measured face.
  ctx.save(); ctx.scale(width / 1255, height / 630);
  if (!overlay) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1255, 630);
    const sky = ctx.createLinearGradient(0, 0, 0, 92);
    for (const [offset, color] of [[0, '#260c29'], [.35, '#7e294c'], [.72, '#d06b83'], [1, '#f6d89a']] as const) sky.addColorStop(offset, color);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1255, 92);
    ctx.fillStyle = '#fff5b9'; ctx.beginPath(); ctx.arc(999, 53, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(0, 82); ctx.bezierCurveTo(361, 10, 621, 115, 965, 87);
    ctx.lineTo(1016, 33);ctx.lineTo(1051, 66);ctx.lineTo(1089, 20);ctx.lineTo(1161, 87);ctx.lineTo(1255, 74);ctx.lineTo(1255, 112);ctx.lineTo(0,112);ctx.fill();
    ctx.restore(); return;
  }
  ctx.save(); ctx.translate(66, 0); ctx.scale(1127 / 1112, 1);
  // Beveled horizontal frame at measured y=92..107 and y=622..630.
  if (referenceState === "06-gamble") { ctx.translate(137,0); ctx.scale(.754,1); }
  for (const [y, h] of [[92, 15], [622, 8]]) {
    const g = ctx.createLinearGradient(0, y!, 0, y! + h!);g.addColorStop(0,'#6b2507');g.addColorStop(.25,'#e7b538');g.addColorStop(.5,'#ffdb58');g.addColorStop(.75,'#8d3902');g.addColorStop(1,'#251704');ctx.fillStyle=g;ctx.fillRect(90,y!,933,h!);
  }
  for (const x of [0, 1024]) {
    const w = x === 0 ? 92 : 88;
    ctx.fillStyle = gold(ctx,x,w);ctx.fillRect(x,72,w,550);
    for(let i=0;i<7;i++){ctx.fillStyle='#ffcc4788';ctx.fillRect(x+7+i*9,80,2,542);ctx.fillStyle='#492808aa';ctx.fillRect(x+10+i*9,80,2,542);}
    ctx.fillStyle=gold(ctx,x-8,w+16);ctx.beginPath();ctx.moveTo(x-15,21);ctx.bezierCurveTo(x+6,-6,x+70,-6,x+94,21);ctx.lineTo(x+78,41);ctx.lineTo(x+66,91);ctx.lineTo(x+4,91);ctx.lineTo(x-3,41);ctx.closePath();ctx.fill();ctx.strokeStyle='#b08b28';ctx.lineWidth=3;ctx.stroke();
    for(const y of [21,49,91,622]){ctx.fillStyle=gold(ctx,x-10,w+30);ctx.fillRect(x-10,y,w+30,5);ctx.strokeStyle='#4c2b0e';ctx.strokeRect(x-10,y,w+30,5);}
  }
  // Narrow red/blue inlays on the five reel boundaries.
  for(let i=0;i<=5;i++){const x=95+i*184;ctx.fillStyle='#d49913';ctx.fillRect(x-5,106,11,516);ctx.fillStyle='#b52813';ctx.fillRect(x-2,106,5,516);for(let y=132;y<618;y+=47){ctx.fillStyle='#2a9dc0';ctx.fillRect(x-2,y,5,20);}ctx.fillStyle='#f8e466';ctx.fillRect(x+4,106,1.5,516);}
  // Rail chips mirror the configured payline count so the ten-line contract is not
  // shown as the Classic capture's nine chips. The capture's scrambled orders are
  // kept only when the contract itself carries nine lines.
  const referenceNine = !paylineCount || paylineCount === 9;
  const left = referenceNine ? [4,2,9,6,1,7,8,3,5] : Array.from({ length: paylineCount }, (_, index) => index + 1);
  const right = referenceNine ? [4,2,8,6,1,7,9,3,5] : left;
  const chipStep = bookChipStep(Math.max(left.length, right.length));
  for(const [side,order] of [[34,left],[1018,right]] as const){for(let i=0;i<order.length;i++){const y=144+i*chipStep;ctx.shadowColor='#000';ctx.shadowBlur=3;ctx.shadowOffsetY=3;ctx.fillStyle=bookPaylineColors[i % bookPaylineColors.length]!;ctx.fillRect(side,y,48,39);ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.strokeStyle='#674310';ctx.lineWidth=2;ctx.strokeRect(side,y,48,39);ctx.fillStyle='#080704';ctx.font='bold 27px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(order[i]),side+24,y+20);}}
  // Original wing ornament and wordmark; no commercial image is embedded.
  if (titleImage) {
    ctx.drawImage(titleImage,14,118,2144,423,364,2,385,76);
  } else {
  ctx.save();ctx.translate(557,40);ctx.scale(.66,.66);
  for(const side of [-1,1]){ctx.save();ctx.scale(side,1);for(let i=0;i<18;i++){const x=25+i*14;ctx.beginPath();ctx.moveTo(x,-27);ctx.quadraticCurveTo(x+13,38-i*.5,x+20,48-i*2);ctx.quadraticCurveTo(x+34,16-i,x+46,-39+i*.4);ctx.closePath();const g=ctx.createLinearGradient(0,-30,0,45);g.addColorStop(0,'#ffd55b');g.addColorStop(.5,'#9b570a');g.addColorStop(.7,'#e6a629');g.addColorStop(1,'#492709');ctx.fillStyle=g;ctx.strokeStyle='#1a0c04';ctx.lineWidth=3;ctx.fill();ctx.stroke();}ctx.restore();}
  ctx.font='bold 80px "Comic Sans MS"';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=12;ctx.strokeStyle='#0b0304';ctx.strokeText('BOOK OF RA',0,-4,580);ctx.lineWidth=8;ctx.strokeStyle='#eac35a';ctx.strokeText('BOOK OF RA',0,-4,580);ctx.lineWidth=3;ctx.strokeStyle='#432706';ctx.strokeText('BOOK OF RA',0,-4,580);const blue=ctx.createLinearGradient(0,-40,0,30);blue.addColorStop(0,'#b3f2f9');blue.addColorStop(.45,'#0c94d8');blue.addColorStop(1,'#083974');ctx.fillStyle=blue;ctx.fillText('BOOK OF RA',0,-4,580);ctx.restore();
  }
  if(width / height > 1.5 && !["01-base", "03-paytable", "04-win", "06-gamble"].includes(referenceState)) {
    ctx.fillStyle='#f5f1e8';ctx.font='bold 14px Arial';ctx.textAlign='left';ctx.textBaseline='alphabetic';
    for(const [label,x,y] of [['Account',92,15],['Pay in',190,15],['0.00',91,41],['#2',103,74],['Help',903,15],['Exit',992,15],['14:34',1010,72]] as const) ctx.fillText(label,x,y);
    ctx.font='16px Arial';ctx.fillText('♪  ◀  ↕  ⛶',962,39);
  }
  ctx.restore();
  ctx.restore();
}

/**
 * Paytable presentation for the 03 reference state: symbol/pay cards filling the
 * reel window below the title and inside the rails, matching the approved capture.
 * Every number comes from the caller's paytable rows; nothing is invented here.
 */
export function drawBookPaytable(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layout: { left: readonly BookPaytableCard[]; right: readonly BookPaytableCard[]; center?: BookPaytableCard },
  drawArt: (symbolId: string, box: BookBox) => void,
): void {
  ctx.save(); ctx.scale(width / 1255, height / 630);
  const colX = [178, 483, 788]; const colW = 291;
  const top = 118, bottom = 614, gap = 12;
  // Every card the config produces gets its own slot: a column grows rows instead of
  // stacking a fourth card on the third, so nothing is silently dropped or hidden.
  const rows = Math.max(1, layout.left.length, layout.right.length);
  const cardH = (bottom - top - gap * (rows - 1)) / rows;
  const rowY = (index: number): number => top + index * (cardH + gap);
  ctx.fillStyle = "#000"; ctx.fillRect(168, 112, 921, 508);
  const paint = (card: BookPaytableCard, x: number, y: number, w: number, h: number, tall = false): void => {
    const face = ctx.createLinearGradient(x, y, x, y + h);
    face.addColorStop(0, "#120c07"); face.addColorStop(1, "#040302");
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fillStyle = face; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = "#c9932f"; ctx.stroke();
    ctx.beginPath(); ctx.roundRect(x + 5, y + 5, w - 10, h - 10, 10); ctx.lineWidth = 1.5; ctx.strokeStyle = "#f6dd93"; ctx.stroke();
    let cursor = y + 14;
    if (tall) {
      ctx.fillStyle = "#7ed957"; ctx.font = "bold 32px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("SCATTER", x + w / 2, cursor); cursor += 42;
    }
    const artBox: BookBox = tall
      ? { x: x + w / 2 - 66, y: cursor, width: 132, height: 152 }
      : { x: x + 12, y: y + 16, width: w * 0.44, height: h - 32 };
    const slot = artBox.width / Math.max(1, card.symbolIds.length);
    card.symbolIds.forEach((symbolId, index) => {
      drawArt(symbolId, { x: artBox.x + index * slot, y: artBox.y, width: slot - 2, height: artBox.height });
    });
    const rows: BookBox = tall
      ? { x: x + 18, y: cursor + 158, width: w - 36, height: Math.max(30, h - 300) }
      : { x: x + w * 0.44 + 8, y: y + 16, width: w * 0.5 - 14, height: h - 40 };
    const rowH = Math.min(34, rows.height / Math.max(1, card.entries.length));
    card.entries.forEach((entry, index) => {
      const cy = rows.y + index * rowH + rowH / 2;
      ctx.fillStyle = bookPaylineColors[index % bookPaylineColors.length]!;
      ctx.beginPath(); ctx.arc(rows.x + 7, cy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffe9a8"; ctx.font = "bold 24px Arial"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(String(entry.count), rows.x + 22, cy);
      ctx.fillStyle = "#ffd24a"; ctx.font = "bold 26px Arial"; ctx.textAlign = "right";
      ctx.fillText(entry.value, rows.x + rows.width, cy);
    });
    if (tall) {
      const captionY = rows.y + rowH * card.entries.length + 32;
      ctx.fillStyle = "#efe0b4"; ctx.font = "bold 18px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("WILD SUBSTITUTES IN", x + w / 2, captionY, w - 36);
      ctx.fillText("REGULAR LINE WINS", x + w / 2, captionY + 22, w - 36);
    }
    ctx.fillStyle = "#9a8a63"; ctx.font = "bold 15px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`x ${card.basis}`, x + w / 2, y + h - 10);
  };
  layout.left.forEach((card, index) => paint(card, colX[0]!, rowY(index), colW, cardH));
  layout.right.forEach((card, index) => paint(card, colX[2]!, rowY(index), colW, cardH));
  if (layout.center) paint(layout.center, colX[1]!, top, colW, bottom - top, true);
  ctx.restore();
}
