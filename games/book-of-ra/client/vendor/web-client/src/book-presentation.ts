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
 /* Landscape cabinet. 1cqw equals 1% of cabinet width; the canvas keeps the
    measured 1112x630 reel-frame face and the lower control band sits directly
    beneath it, sized to the reference's 111..131 band of a 761-tall cabinet. */
 :host([presentation="classic"]) .game.immersive canvas.reel-canvas {aspect-ratio:1/.5671}
 /* Landscape cabinet. The reel frame keeps its measured 1112x630 face; the
    lower control band is sized so the panel occupies the reference's
    82.5%..97.9% share of cabinet height. All offsets are quoted against
    cqw = 1% of cabinet width because container queries only expose inline size. */
 :host([presentation="classic"]) .game.immersive .console.cabinet {position:relative;height:10.0cqw;margin:0;border:0;background:linear-gradient(#7a3210,#8f3d12 40%,#54230c);box-shadow:inset 0 0 0 .3cqw #b4731c,inset 0 .5cqw .7cqw #2a0f05,inset 0 -.4cqw .6cqw #230d04}
 :host([presentation="classic"]) .cab-meter small {height:.85cqw;border:.07cqw solid #6d4a1c;border-radius:.3cqw;background:linear-gradient(#6d3a12,#4a2509);color:#f4e6c6;font:bold .75cqw/.85cqw Arial,sans-serif}
 :host([presentation="classic"]) .cab-meter strong {margin-top:.08cqw;height:1.75cqw;border:.1cqw ridge #6f6a60;border-radius:.28cqw;background:linear-gradient(#060504,#150f0b);color:#ffe14a;font:bold 1.25cqw/1.7cqw Arial,sans-serif}
 :host([presentation="classic"]) .cab-meter:first-child small {width:88%;margin:auto}
 :host([presentation="classic"]) .cab-meter:nth-child(4) small {width:85%;margin:auto}
 :host([presentation="classic"]) .meter-adjust {top:.85cqw;width:2.3cqw;height:1.75cqw;border:.1cqw ridge #6f6a60;border-radius:.28cqw;background:linear-gradient(#9a9b93,#4d4e46);color:#2b2c26;font:bold 1.25cqw Arial,sans-serif}
 /* Bottom control bar: MENU, payline buttons, credit/bet meters, MAX BET, AUTO and START,
    laid out left-to-right on the reference's single control row. */
 :host([presentation="classic"]) .cab-key.paytable,:host([presentation="classic"]) .cab-key[data-key="gamble"] {top:7.0cqw;height:2.4cqw;font-size:1.05cqw}
 :host([presentation="classic"]) .cab-key[data-key="lines"],:host([presentation="classic"]) .cab-key[data-key="betline"],:host([presentation="classic"]) .cab-key[data-key="bet"] {top:7.0cqw;height:2.4cqw;font-size:1.0cqw}
 :host([presentation="classic"]) .cab-key[data-key="menu"] {left:2.16cqw;top:7.0cqw;width:6.2cqw;height:2.4cqw;font-size:1.0cqw}
 :host([presentation="classic"]) .cab-key[data-key="lines"] {left:8.99cqw;width:5.6cqw}
 :host([presentation="classic"]) .cab-key[data-key="betline"] {left:15.31cqw;width:8.6cqw}
 :host([presentation="classic"]) .cab-key[data-key="bet"] {left:24.51cqw;width:6.2cqw}
 :host([presentation="classic"]) .cab-key[data-key="max"] {left:51.71cqw;top:7.0cqw;width:6.4cqw;height:2.4cqw;font-size:1.05cqw}
 :host([presentation="classic"]) .cab-key[data-key="autoplay"] {left:62.05cqw;top:7.0cqw;width:6.6cqw;height:2.0cqw;font-size:1.1cqw}
 :host([presentation="classic"]) .cab-key.paytable {left:29.2%;width:9.6%;background:linear-gradient(#f2e6c8,#c99a52 45%,#8a5a1c)}
 :host([presentation="classic"]) .cab-key[data-key="gamble"] {left:39.2%;width:9.6%}
 :host([presentation="classic"]) .spin.cab-start {left:72.57cqw;top:7.0cqw;width:9.17cqw;height:2.4cqw;font-size:1.05cqw}
 :host([presentation="classic"]) .spin-icon {width:1.3cqw;height:1.3cqw}
 :host([presentation="classic"]) .cab-meter.win-total {left:auto;right:31.2%;top:4.7cqw;width:9cqw}
 :host([presentation="classic"]) .cab-key[data-key="menu"] {background:linear-gradient(#c9c6b6,#8d8a7c 45%,#5c5a50)}
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

export function drawBookCabinet(ctx: CanvasRenderingContext2D, width: number, height: number, overlay: boolean, referenceState = "", titleImage?: HTMLImageElement): void {
  ctx.save(); ctx.scale(width / 1112, height / 630);
  if (!overlay) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1112, 630);
    const sky = ctx.createLinearGradient(0, 0, 0, 88);
    for (const [offset, color] of [[0, '#260c29'], [.35, '#7e294c'], [.72, '#d06b83'], [1, '#f6d89a']] as const) sky.addColorStop(offset, color);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 1112, 90);
    ctx.fillStyle = '#fff5b9'; ctx.beginPath(); ctx.arc(885, 53, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(0, 80); ctx.bezierCurveTo(320, 10, 550, 115, 855, 85);
    ctx.lineTo(900, 33);ctx.lineTo(931, 66);ctx.lineTo(965, 20);ctx.lineTo(1029, 85);ctx.lineTo(1112, 72);ctx.lineTo(1112, 110);ctx.lineTo(0,110);ctx.fill();
    ctx.restore(); return;
  }
  // Beveled horizontal frame at measured y=92..107 and y=622..630.
  if (referenceState === "06-gamble") { ctx.translate(137,0); ctx.scale(.754,1); }
  for (const [y, h] of [[92, 15], [622, 8]]) {
    const g = ctx.createLinearGradient(0, y!, 0, y! + h!);g.addColorStop(0,'#6b2507');g.addColorStop(.25,'#e7b538');g.addColorStop(.5,'#ffdb58');g.addColorStop(.75,'#8d3902');g.addColorStop(1,'#251704');ctx.fillStyle=g;ctx.fillRect(88,y!,960,h!);
  }
  for (const x of [0, 1038]) {
    const w = x === 0 ? 92 : 74;
    ctx.fillStyle = gold(ctx,x,w);ctx.fillRect(x,72,w,550);
    for(let i=0;i<7;i++){ctx.fillStyle='#ffcc4788';ctx.fillRect(x+7+i*9,80,2,542);ctx.fillStyle='#492808aa';ctx.fillRect(x+10+i*9,80,2,542);}
    ctx.fillStyle=gold(ctx,x-8,w+16);ctx.beginPath();ctx.moveTo(x-15,21);ctx.bezierCurveTo(x+6,-6,x+70,-6,x+94,21);ctx.lineTo(x+78,41);ctx.lineTo(x+66,91);ctx.lineTo(x+4,91);ctx.lineTo(x-3,41);ctx.closePath();ctx.fill();ctx.strokeStyle='#b08b28';ctx.lineWidth=3;ctx.stroke();
    for(const y of [21,49,91,622]){ctx.fillStyle=gold(ctx,x-10,w+30);ctx.fillRect(x-10,y,w+30,5);ctx.strokeStyle='#4c2b0e';ctx.strokeRect(x-10,y,w+30,5);}
  }
  // Narrow red/blue inlays on the five reel boundaries.
  for(let i=0;i<=5;i++){const x=97+i*188;ctx.fillStyle='#d49913';ctx.fillRect(x-5,106,11,516);ctx.fillStyle='#b52813';ctx.fillRect(x-2,106,5,516);for(let y=132;y<618;y+=47){ctx.fillStyle='#2a9dc0';ctx.fillRect(x-2,y,5,20);}ctx.fillStyle='#f8e466';ctx.fillRect(x+4,106,1.5,516);}
  const colors=['#fbed53','#f04f4b','#f7c77a','#c4ed61','#54ade9','#edb69c','#9bd0df','#5bbb4c','#f08bd3'];
  const left=[4,2,9,6,1,7,8,3,5],right=[4,2,8,6,1,7,9,3,5];
  for(const [side,order] of [[30,left],[1051,right]] as const){for(let i=0;i<9;i++){const y=149+i*48.5;ctx.shadowColor='#000';ctx.shadowBlur=3;ctx.shadowOffsetY=3;ctx.fillStyle=colors[i]!;ctx.fillRect(side,y,55,39);ctx.shadowBlur=0;ctx.shadowOffsetY=0;ctx.strokeStyle='#674310';ctx.lineWidth=2;ctx.strokeRect(side,y,55,39);ctx.fillStyle='#080704';ctx.font='bold 28px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(order[i]),side+27.5,y+20);}}
  // Original wing ornament and wordmark; no commercial image is embedded.
  if (titleImage) {
    ctx.drawImage(titleImage,14,118,2144,423,346,7,420,83);
  } else {
  ctx.save();ctx.translate(556,48);ctx.scale(.72,.72);
  for(const side of [-1,1]){ctx.save();ctx.scale(side,1);for(let i=0;i<18;i++){const x=25+i*14;ctx.beginPath();ctx.moveTo(x,-27);ctx.quadraticCurveTo(x+13,38-i*.5,x+20,48-i*2);ctx.quadraticCurveTo(x+34,16-i,x+46,-39+i*.4);ctx.closePath();const g=ctx.createLinearGradient(0,-30,0,45);g.addColorStop(0,'#ffd55b');g.addColorStop(.5,'#9b570a');g.addColorStop(.7,'#e6a629');g.addColorStop(1,'#492709');ctx.fillStyle=g;ctx.strokeStyle='#1a0c04';ctx.lineWidth=3;ctx.fill();ctx.stroke();}ctx.restore();}
  ctx.font='bold 80px "Comic Sans MS"';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=12;ctx.strokeStyle='#0b0304';ctx.strokeText('BOOK OF RA',0,-4,580);ctx.lineWidth=8;ctx.strokeStyle='#eac35a';ctx.strokeText('BOOK OF RA',0,-4,580);ctx.lineWidth=3;ctx.strokeStyle='#432706';ctx.strokeText('BOOK OF RA',0,-4,580);const blue=ctx.createLinearGradient(0,-40,0,30);blue.addColorStop(0,'#b3f2f9');blue.addColorStop(.45,'#0c94d8');blue.addColorStop(1,'#083974');ctx.fillStyle=blue;ctx.fillText('BOOK OF RA',0,-4,580);ctx.restore();
  }
  if(width / height > 1.5 && !["01-base", "03-paytable", "04-win", "06-gamble"].includes(referenceState)) {
    ctx.fillStyle='#f5f1e8';ctx.font='bold 14px Arial';ctx.textAlign='left';ctx.textBaseline='alphabetic';
    for(const [label,x,y] of [['Account',92,15],['Pay in',190,15],['0.00',91,41],['#2',103,74],['Help',903,15],['Exit',992,15],['14:34',1010,72]] as const) ctx.fillText(label,x,y);
    ctx.font='16px Arial';ctx.fillText('♪  ◀  ↕  ⛶',962,39);
  }
  ctx.restore();
}
