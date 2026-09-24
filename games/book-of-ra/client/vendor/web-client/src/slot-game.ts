import type { AmbientEffectConfig, AssetEntry, GameConfig } from "@slot-skills/schema";
import type { GameEvent, GameRoundResult, PendingAction } from "@slot-skills/runtime";
import { EffectManager, effectRegistry, effectIds, fixedTarget, type EffectId, type EffectOptions, type EffectTargetKind } from "@slot-skills/canvas-effects";
import { MessageCatalog } from "./localization.js";
import { characterAnimationDurationMs, characterWinSize, mappedCharacterAnimation, mayCelebrate, paytableRows, remainingCharacterPoseLockMs } from "./presentation.js";
import { sampleReelMotion, type ReelMotion } from "./reel-motion.js";
import { HttpSlotTransport, type SlotTransport } from "./transport.js";
import { AmbientEffectRenderer } from "./ambient-effects.js";
import { installCharacterSpine } from "@slot-skills/spine/browser";
import { configuredEventEffect } from "./effect-config.js";
import { heldCellTransition, parseHeldCells } from "./hold-and-win.js";
import { bookStyles, drawBookCabinet, type SymbolImagePresentation } from "./book-presentation.js";

export interface SlotRoundResultEventDetail { result: GameRoundResult; }
export interface SlotEventPlayedEventDetail { event: GameEvent; result: GameRoundResult; }
export interface SlotErrorEventDetail { error: Error; operation: "spin" | "action" | "playback"; }

interface ReelSpinState {
  startedAt: number;
  target?: string[][];
  heldCells?: boolean[][];
  motions?: ReelMotion[];
  /** Presentation-only: nominal landing time per reel, used by the motion test. */
  settleTimes?: number[];
  resolve?: () => void;
}

interface RemovalAnimation {
  cells: Set<string>;
  startedAt: number;
  duration: number;
  resolved: boolean;
  resolve?: () => void;
}

interface DropAnimation {
  fromGrid: string[][];
  toGrid: string[][];
  removedCells: Set<string>;
  startedAt: number;
  duration: number;
  resolve?: () => void;
}

interface CellBox { x: number; y: number; width: number; height: number; }

// Reel-grid insets inside the canvas (fraction of canvas height), shared between #reelArea and
// the stylesheet so the character's feet stay level with the reel-area bottom line. Immersive
// canvases fill the character slot exactly; the card layout additionally offsets by the stage
// border, which sits between the reel canvas and the stage-row edge.
const IMMERSIVE_REEL_INSET = 0.015;
const CARD_REEL_INSET = 0.075;

const stylesheet = `
  :host { display:block; --panel:#080c18; --ink:#f7f8ff; --accent:#ffd34f; color:var(--ink); font:650 16px/1.3 Inter,ui-sans-serif,system-ui,sans-serif; }
  * { box-sizing:border-box; }
  .game { position:relative; overflow:visible; isolation:isolate; border:1px solid #ffffff20; border-radius:clamp(18px,3vw,30px); background:linear-gradient(145deg,color-mix(in srgb,var(--panel),#fff 8%),var(--panel)); padding:clamp(9px,1.6vw,19px); box-shadow:0 28px 80px #000a,inset 0 1px #ffffff21; }
  .game::before { content:""; position:absolute; z-index:-1; inset:-35% 15% auto; height:55%; background:var(--accent); filter:blur(100px); opacity:.13; }
  .marquee { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:3px clamp(5px,1vw,12px) 8px; }
  .brand { min-width:0; }
  .brand small { display:block; color:color-mix(in srgb,var(--accent),#fff 25%); font-size:clamp(.58rem,1.3vw,.72rem); font-weight:900; letter-spacing:.2em; text-transform:uppercase; }
  .title { overflow:hidden; margin:1px 0 0; font:900 clamp(1.35rem,4.5vw,2.85rem)/1 ui-rounded,system-ui; letter-spacing:-.045em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; text-shadow:0 3px 0 #0007,0 0 24px color-mix(in srgb,var(--accent),transparent 60%); }
  .state { flex:0 0 auto; display:flex; align-items:center; gap:7px; border:1px solid #ffffff1d; border-radius:999px; padding:7px 10px; background:#02050ba6; color:#c9d1de; font-size:.67rem; font-weight:900; letter-spacing:.13em; }
  .state::before { content:""; width:7px; height:7px; border-radius:50%; background:#6ff2a6; box-shadow:0 0 11px #6ff2a6; }
  .state[data-state="SPINNING"]::before,.state[data-state="STOPPING"]::before,.state[data-state="CASCADE"]::before,.state[data-state="FEATURE"]::before { background:var(--accent); box-shadow:0 0 11px var(--accent); }
  .feature-strip { display:flex; flex-wrap:wrap; gap:6px; min-height:0; padding:0 clamp(5px,1vw,12px) 8px; }
  .feature-strip:empty { padding-bottom:2px; }
  .chip { display:inline-flex; align-items:center; gap:6px; border:1px solid color-mix(in srgb,var(--accent),transparent 55%); border-radius:999px; padding:4px 10px; background:#050a14d9; color:#ffe9a8; font-size:.66rem; font-weight:900; letter-spacing:.08em; text-transform:uppercase; animation:chip-in .28s cubic-bezier(.2,.9,.3,1.4); }
  .chip strong { color:#fff; font-size:.78rem; }
  .chip.bump { animation:chip-bump .34s cubic-bezier(.2,.9,.3,1.6); }
  @keyframes chip-in { from { opacity:0; transform:translateY(6px) scale(.8); } }
  @keyframes chip-bump { 40% { transform:scale(1.16); } }
  .stage { position:relative; overflow:visible; border:clamp(5px,1vw,10px) solid #111827; border-radius:clamp(14px,2vw,23px); background:#050812 center/cover no-repeat; box-shadow:inset 0 0 0 2px #ffffff24,inset 0 0 35px #000,0 7px 22px #0009; }
  .stage::before { content:""; position:absolute; z-index:2; pointer-events:none; inset:0; border-radius:inherit; box-shadow:inset 0 12px 24px #0009,inset 0 -12px 24px #0009; }
  canvas { display:block; width:100%; aspect-ratio:16/8.7; }
  .reel-canvas { position:relative; z-index:1; }
  .effect-canvas { position:absolute; z-index:2; inset:0; height:100%; pointer-events:none; }
  .reel-frame { position:absolute; z-index:3; left:4.5%; top:7.5%; width:91%; height:85%; object-fit:fill; pointer-events:none; user-select:none; transform:scale(var(--frame-scale,1.07)); transform-origin:center; }
  .float-layer { position:absolute; z-index:4; inset:0; overflow:hidden; pointer-events:none; }
  .payline-overlay { position:absolute; z-index:3; inset:0; width:100%; height:100%; pointer-events:none; opacity:0; transition:opacity .15s; }
  .payline-overlay.active { opacity:.92; }
  .payline-overlay polyline { fill:none; stroke:#d7ff4a; stroke-width:1.2; stroke-linejoin:round; stroke-linecap:round; filter:drop-shadow(0 0 2px #000); }
  .float-prize { position:absolute; left:50%; top:58%; transform:translate(-50%,0); color:#9dffc2; font:950 clamp(1rem,2.6vw,1.6rem)/1 ui-rounded,system-ui; letter-spacing:.04em; text-shadow:0 0 14px #37ff8f88,0 2px 0 #0008; animation:prize-float 1.15s cubic-bezier(.2,.7,.3,1) forwards; }
  @keyframes prize-float { 12% { opacity:1; transform:translate(-50%,-8px) scale(1.08); } 100% { opacity:0; transform:translate(-50%,-74px) scale(.94); } }
  .announce { position:absolute; z-index:5; left:50%; top:50%; width:max-content; max-width:92%; transform:translate(-50%,-50%) scale(.7); border:1px solid color-mix(in srgb,var(--accent),#fff 35%); border-radius:18px; padding:14px 30px; background:linear-gradient(160deg,#131a30f2,#070b16f5); opacity:0; pointer-events:none; text-align:center; box-shadow:0 0 60px color-mix(in srgb,var(--accent),transparent 45%),inset 0 1px #ffffff2e; transition:opacity .22s,transform .3s cubic-bezier(.2,.9,.3,1.45); }
  .announce.active { opacity:1; transform:translate(-50%,-50%) scale(1); }
  .announce h3 { margin:0; font:950 clamp(1.15rem,3.4vw,2.1rem)/1.08 ui-rounded,system-ui; letter-spacing:.05em; text-transform:uppercase; color:#fff3c2; text-shadow:0 0 22px color-mix(in srgb,var(--accent),transparent 30%),0 3px 0 #0008; }
  .announce p { margin:5px 0 0; color:#c8d2e6; font-size:clamp(.72rem,1.7vw,.92rem); font-weight:800; letter-spacing:.09em; text-transform:uppercase; }
  .announce[data-tone="jackpot"] { border-color:#ffe08a; box-shadow:0 0 90px #ffb02faa,inset 0 1px #ffffff40; }
  .announce[data-tone="jackpot"] h3 { color:#ffe08a; }
  .announce[data-tone="loss"] { border-color:#ff7b8d66; box-shadow:0 0 40px #ff3b5d44; }
  .announce[data-tone="loss"] h3 { color:#ffb1bd; text-shadow:0 0 18px #ff3b5d66; }
  .win-message { position:absolute; z-index:4; left:50%; top:50%; width:max-content; max-width:90%; transform:translate(-50%,-50%) scale(.82); border:1px solid #fff6b8; border-radius:999px; padding:10px 22px; background:#080b16e8; color:#fff4ad; font:950 clamp(1rem,3vw,1.8rem)/1 ui-rounded,system-ui; letter-spacing:.06em; opacity:0; pointer-events:none; text-align:center; text-shadow:0 0 17px #ffcf42; box-shadow:0 0 50px #ffce4266; transition:opacity .18s,transform .22s cubic-bezier(.2,.8,.2,1); }
  .win-message.active { opacity:1; transform:translate(-50%,-50%) scale(1); }
  .bonus { position:absolute; z-index:6; inset:0; display:flex; align-items:center; justify-content:center; background:#02040bd8; backdrop-filter:blur(3px); opacity:0; pointer-events:none; transition:opacity .25s; }
  .bonus.active { opacity:1; pointer-events:auto; }
  .bonus-panel { width:min(520px,92%); border:1px solid color-mix(in srgb,var(--accent),#fff 25%); border-radius:20px; padding:clamp(14px,3vw,26px); background:linear-gradient(165deg,#141b31f6,#080c18fa); text-align:center; box-shadow:0 0 70px color-mix(in srgb,var(--accent),transparent 55%),inset 0 1px #ffffff26; transform:translateY(12px) scale(.94); transition:transform .3s cubic-bezier(.2,.9,.3,1.35); }
  .bonus.active .bonus-panel { transform:none; }
  .bonus-panel h3 { margin:0 0 4px; font:950 clamp(1.05rem,3vw,1.6rem)/1.1 ui-rounded,system-ui; letter-spacing:.06em; text-transform:uppercase; color:#fff3c2; text-shadow:0 0 18px color-mix(in srgb,var(--accent),transparent 40%); }
  .bonus-panel p { margin:0 0 14px; color:#aab6cc; font-size:.74rem; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
  .bonus-grid { display:flex; flex-wrap:wrap; gap:12px; justify-content:center; }
  .bonus-card { position:relative; width:clamp(84px,22%,120px); aspect-ratio:3/4; border:1px solid #ffffff2c; border-radius:14px; background:linear-gradient(155deg,#232f52,#101728); color:#ffe9a8; font:950 1.4rem/1 ui-rounded,system-ui; cursor:pointer; box-shadow:0 8px 20px #0009,inset 0 1px #ffffff22; transition:transform .18s,box-shadow .18s,opacity .3s; }
  .bonus-card::before { content:""; position:absolute; inset:7px; border:1px dashed color-mix(in srgb,var(--accent),transparent 45%); border-radius:9px; }
  .bonus-card small { position:absolute; left:0; right:0; bottom:9px; color:#93a2c0; font-size:.58rem; font-weight:900; letter-spacing:.12em; text-transform:uppercase; }
  .bonus-card:hover:not(:disabled) { transform:translateY(-4px) scale(1.04); box-shadow:0 14px 26px #000b,0 0 24px color-mix(in srgb,var(--accent),transparent 55%); }
  .bonus-card:disabled { cursor:default; opacity:.35; }
  .bonus-card.picked { animation:card-pop .5s cubic-bezier(.2,.9,.3,1.5); border-color:#ffe08a; opacity:1; }
  @keyframes card-pop { 45% { transform:scale(1.14) rotate(2deg); } }
  .wheel-wrap { display:grid; place-items:center; margin:0 auto 16px; }
  .wheel { width:clamp(150px,42vw,210px); aspect-ratio:1; border-radius:50%; border:6px solid #111827; background:conic-gradient(var(--accent) 0 25%,#3d2a7d 25% 50%,#c2452f 50% 75%,#1c7d64 75% 100%); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent),transparent 40%),0 0 44px color-mix(in srgb,var(--accent),transparent 55%),inset 0 0 30px #0009; transition:transform 2.1s cubic-bezier(.16,.9,.14,1); }
  .wheel-wrap::before { content:""; position:relative; z-index:1; top:9px; width:0; height:0; border:11px solid transparent; border-top:16px solid #fff3c2; filter:drop-shadow(0 2px 3px #000c); }
  .gamble-row { display:flex; gap:14px; justify-content:center; }
  .gamble-row .bonus-choice { min-width:130px; }
  .bonus-choice { border:1px solid #ffffff30; border-radius:999px; padding:13px 22px; background:linear-gradient(160deg,#27335c,#141b31); color:#fff; font:900 .85rem/1 inherit; letter-spacing:.09em; text-transform:uppercase; cursor:pointer; box-shadow:0 6px 16px #0008,inset 0 1px #ffffff28; transition:transform .15s,filter .15s; }
  .bonus-choice:hover:not(:disabled) { transform:translateY(-2px); filter:brightness(1.15); }
  .bonus-choice:disabled { opacity:.4; cursor:default; }
  .bonus-choice[data-style="red"] { background:linear-gradient(160deg,#a3243a,#5c0f1e); border-color:#ff8fa0aa; }
  .bonus-choice[data-style="black"] { background:linear-gradient(160deg,#2a2f3d,#0b0d14); border-color:#aab6ccaa; }
  .bonus-choice[data-style="gold"] { background:linear-gradient(160deg,color-mix(in srgb,var(--accent),#8a5200 25%),#6b3c05); border-color:#ffe08a; color:#1c1303; }
  .console { display:grid; grid-template-columns:minmax(90px,1fr) auto minmax(90px,1fr); align-items:center; gap:clamp(8px,2vw,18px); margin-top:12px; padding:clamp(8px,1.5vw,13px); border:1px solid #ffffff14; border-radius:18px; background:linear-gradient(180deg,#111827,#070b13); box-shadow:inset 0 1px #ffffff12; }
  .meters { display:flex; min-width:0; gap:clamp(8px,2vw,22px); }
  .meter { min-width:0; }
  .meter small { display:block; color:#8793a7; font-size:.62rem; font-weight:900; letter-spacing:.13em; text-transform:uppercase; }
  .meter strong,.meter output { display:block; overflow:hidden; color:#f8fbff; font-size:clamp(.83rem,2vw,1.07rem); font-weight:900; text-overflow:ellipsis; white-space:nowrap; }
  .win-total { justify-content:flex-end; text-align:right; }
  .spin { position:relative; width:clamp(74px,11vw,94px); aspect-ratio:1; border:4px solid color-mix(in srgb,var(--accent),#fff 30%); border-radius:50%; background:radial-gradient(circle at 35% 28%,#fff7bf 0 4%,var(--accent) 34%,color-mix(in srgb,var(--accent),#8b4d00 52%) 100%); color:#171103; font:950 clamp(.88rem,2vw,1.12rem)/1 ui-rounded,system-ui; letter-spacing:.07em; cursor:pointer; box-shadow:0 0 0 5px #02050b,0 0 0 7px #ffffff1c,0 8px 22px #000b,0 0 28px color-mix(in srgb,var(--accent),transparent 58%); transition:transform .12s,filter .12s; }
  .spin:hover:not(:disabled) { transform:translateY(-2px) scale(1.025); filter:brightness(1.08); }
  .spin:active:not(:disabled) { transform:translateY(1px) scale(.97); }
  .spin:disabled { cursor:wait; filter:saturate(.55); opacity:.72; }
  .paytable { border:1px solid #ffffff25; border-radius:999px; margin-top:10px; padding:8px 14px; background:#080d18b8; color:#dbe4f4; font:800 .74rem/1 inherit; cursor:pointer; }
  .error { margin:0 0 12px; padding:10px 14px; border:1px solid #ff7b8d88; border-radius:10px; background:#60182dcc; color:#fff; }
  dialog { width:min(720px,calc(100% - 24px)); max-height:80vh; color:var(--ink); background:#11162a; border:1px solid #ffffff2b; border-radius:14px; }
  dialog::backdrop { background:#02040bdc; }
  dialog .close { position:sticky; top:0; float:right; }
  dialog button { border:1px solid #ffffff28; border-radius:999px; padding:10px 16px; background:#1a2235; color:inherit; font:inherit; cursor:pointer; }
  table { border-collapse:collapse; width:100%; } td,th { padding:7px 10px; border-bottom:1px solid #ffffff1a; text-align:left; }
  .sr-grid { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
  .stage-row { position:relative; overflow:visible; border-radius:clamp(14px,2vw,23px); }
  .stage { position:relative; z-index:1; }
  .character-slot { display:contents; overflow:visible; }
  .character { position:absolute; z-index:3; right:-1.5%; bottom:calc(${CARD_REEL_INSET * 100}% + clamp(5px,1vw,10px)); height:88%; max-width:26%; object-fit:contain; object-position:bottom; pointer-events:none; filter:drop-shadow(0 10px 24px #000b); transform:translate(var(--character-offset-x,0%),var(--character-offset-y,0%)) scale(var(--character-scale,1)); transform-origin:center bottom; transition:transform .25s; }
  .character[data-pose="cast"] { filter:drop-shadow(0 10px 24px #000b) drop-shadow(0 0 34px #9db8ff88); }
  .game.immersive { border:0; border-radius:0; background:transparent; padding:0; box-shadow:none; }
  .game.immersive::before { display:none; }
  .game.immersive .marquee { display:none; }
  .game.immersive .feature-strip { padding:0 0 6px; }
  .game.immersive .stage-row:has(.character) { display:grid; grid-template-columns:minmax(0,1fr) clamp(190px,22%,270px); align-items:end; }
  .game.immersive .stage { border:0; border-radius:16px; background:transparent; box-shadow:none; }
  .game.immersive .stage::before { display:none; }
  .game.immersive canvas { aspect-ratio:16/8.5; }
  .game.immersive .reel-frame { left:0; top:0; width:100%; height:100%; }
  .game.immersive .character-slot { display:block; position:relative; min-width:0; align-self:stretch; overflow:visible; }
  .game.immersive .character { position:absolute; left:50%; right:auto; bottom:calc(${IMMERSIVE_REEL_INSET * 100}% - var(--character-bottom-shift,0px)); width:auto; height:var(--character-height,560px); max-width:none; object-fit:contain; object-position:center bottom; transform:translate(calc(-50% + var(--character-offset-x,0%)),var(--character-offset-y,0%)) scale(var(--character-scale,1)); transform-origin:center bottom; }
  .game.immersive .character[data-pose="cast"] { transform:translate(calc(-50% + var(--character-offset-x,0%)),var(--character-offset-y,0%)) scale(var(--character-scale,1)); }
  .game.character-overflow { overflow:visible; }
  .game.immersive.character-overflow .stage-row { overflow:visible; }
  .game.immersive .console { border-color:#ffffff10; background:#070b13c9; }
  .game.immersive .console.cabinet { margin:0 -1px; }
  .game.immersive .toggle,.game.immersive .buy,.game.immersive .paytable { background:#070b13c9; }
  /* Classic cabinet control deck: a flat brushed strip with pressed keys,
     deliberately not the rounded panel the default console uses. */
  .console.cabinet { display:block; margin:0; padding:0; border:0; border-radius:0; background:none; box-shadow:none; }
  .cab-meters { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:3px; padding:4px; border:2px solid #7a4a16; border-top-color:#e7b463; border-bottom-color:#2f1c06; border-radius:2px; background:linear-gradient(180deg,#a9742c,#7d4f16 42%,#4a2d0a); box-shadow:inset 0 1px #ffd98a88,0 3px 0 #2a1808,0 8px 18px #000a; }
  .cab-meter { min-width:0; padding:5px clamp(6px,1.2vw,14px); border:1px solid #000; border-radius:2px; background:radial-gradient(120% 140% at 50% 0%,#120d06,#050302); text-align:center; box-shadow:inset 0 2px 5px #000,inset 0 -1px #ffd98a1a; }
  .cab-meter small { display:block; color:#c79a58; font-size:.56rem; font-weight:900; letter-spacing:.18em; text-transform:uppercase; }
  .cab-meter strong,.cab-meter output { display:block; overflow:hidden; color:#ffd76a; font:900 clamp(.85rem,2vw,1.25rem)/1.25 ui-monospace,"Courier New",monospace; text-overflow:ellipsis; white-space:nowrap; text-shadow:0 0 10px #ffb02e66; }
  .cab-meter.win-total output { color:#fff3c2; }
  .cab-deck { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)) auto; align-items:stretch; gap:clamp(4px,.9vw,10px); margin-top:6px; }
  .cab-key { border:2px solid #7a4a16; border-top-color:#e7b463; border-bottom-color:#2f1c06; border-radius:3px; padding:clamp(9px,1.6vw,16px) 6px; background:linear-gradient(180deg,#b57f2f 0%,#8a5a1c 46%,#5a3810 100%); color:#fff2d2; font:900 clamp(.62rem,1.45vw,.88rem)/1 inherit; letter-spacing:.14em; text-transform:uppercase; cursor:pointer; text-shadow:0 1px 0 #3a2409; box-shadow:inset 0 1px #ffd98a88,inset 0 -3px 6px #0006,0 4px 0 #2a1808,0 7px 14px #0009; }
  .cab-key:hover:not(:disabled) { background:linear-gradient(180deg,#54381a,#241609); }
  .cab-key:active:not(:disabled) { transform:translateY(2px); box-shadow:inset 0 1px #ffffff14,0 1px 0 #0f0a04; }
  .cab-key:disabled { opacity:.42; cursor:default; }
  .spin.cab-start { width:auto; min-width:clamp(110px,18vw,220px); aspect-ratio:auto; border-radius:3px; border:2px solid #1f6b22; border-top-color:#8ef07a; border-bottom-color:#0d3a10; background:linear-gradient(180deg,#8bea6a 0%,#3fbd3a 42%,#1f8a22 74%,#14631a 100%); color:#0d2b0c; font:900 clamp(.86rem,2.1vw,1.3rem)/1 inherit; letter-spacing:.22em; text-transform:uppercase; text-shadow:0 1px 0 #bff4a8; box-shadow:inset 0 2px #ffffff88,inset 0 -5px 10px #0005,0 5px 0 #0d3a10,0 9px 20px #000a,0 0 26px #5ee04a55; }
  .spin.cab-start:active:not(:disabled) { transform:translateY(3px); box-shadow:inset 0 2px #ffffff22,0 1px 0 #4d0f07; }
  .game.immersive .console.cabinet { background:none; border:0; }
  @media (max-width:560px) {
    .cab-meters { grid-template-columns:repeat(3,minmax(0,1fr)); }
    .cab-deck { grid-template-columns:repeat(2,minmax(0,1fr)); }
    .spin.cab-start { grid-column:1 / -1; }
  }
  .extras { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .extras:empty { display:none; }
  .toggle { display:inline-flex; align-items:center; gap:8px; border:1px solid #ffffff25; border-radius:999px; padding:8px 14px; background:#080d18b8; color:#dbe4f4; font:800 .74rem/1 inherit; cursor:pointer; }
  .toggle[aria-pressed="true"] { border-color:color-mix(in srgb,var(--accent),#fff 25%); background:color-mix(in srgb,var(--accent),#080d18 82%); color:#ffe9a8; box-shadow:0 0 18px color-mix(in srgb,var(--accent),transparent 65%); }
  .buy { border:1px solid #ffe08a88; border-radius:999px; padding:8px 14px; background:linear-gradient(160deg,color-mix(in srgb,var(--accent),#8a5200 30%),#3d2a05); color:#ffedc0; font:900 .74rem/1 inherit; letter-spacing:.05em; cursor:pointer; }
  .buy:hover:not(:disabled) { filter:brightness(1.15); }
  .buy:disabled,.toggle:disabled { opacity:.4; cursor:default; }
  .audio { display:inline-flex; align-items:center; gap:10px; margin-left:auto; }
  .vol { display:inline-flex; align-items:center; gap:6px; color:#8793a7; font-size:.62rem; font-weight:900; letter-spacing:.1em; text-transform:uppercase; }
  .vol input[type="range"] { width:clamp(70px,9vw,110px); height:4px; appearance:none; border-radius:999px; background:#ffffff28; accent-color:var(--accent); cursor:pointer; }
  .vol input[type="range"]::-webkit-slider-thumb { appearance:none; width:13px; height:13px; border-radius:50%; background:var(--accent); border:2px solid #08080f; box-shadow:0 0 8px color-mix(in srgb,var(--accent),transparent 40%); }
  .game.fit .feature-strip { min-height:34px; }
  .game.fit .extras { min-height:36px; }
  @media (max-width:560px) { .game { border-radius:17px; padding:7px; } .marquee { padding-bottom:6px; } .state { padding:6px 8px; } .console { grid-template-columns:1fr auto 1fr; } .meters { display:block; } .meters .meter + .meter { margin-top:5px; } .paytable { margin-top:7px; } }
  @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
`;

function formatMinorUnits(value: string): string {
  const units = BigInt(value); const negative = units < 0n; const absolute = negative ? -units : units;
  return `${negative ? "−" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function clamp(value: number, minimum = 0, maximum = 1): number { return Math.min(maximum, Math.max(minimum, value)); }

function titleCase(id: string): string { return id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }

/** Reference layout width for viewport-fit scaling; the component is laid out at this width and scaled. */
const FIT_DESIGN_WIDTH = 1200;
/** Below this available width the component keeps its natural flow layout (portrait phones). */
const FIT_MIN_SCALE_WIDTH = 720;
const FIT_MAX_SCALE = 1.5;

/** Preloads and plays short sound-effect assets with a small overlap cap and a master gain. */
class SoundBank {
  #sources = new Map<string, string>();
  #active = 0;
  /** Master gain applied on top of each cue's relative volume. */
  master = 1;

  register(id: string, url: string): void {
    if (this.#sources.has(id)) return;
    this.#sources.set(id, url);
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
  }

  play(id: string, volume = 0.8): void {
    const url = this.#sources.get(id);
    const gain = clamp(volume * this.master, 0, 1);
    if (!url || this.#active >= 8 || gain <= 0) return;
    const node = new Audio(url);
    node.volume = gain;
    this.#active += 1;
    const release = () => { this.#active = Math.max(0, this.#active - 1); };
    node.addEventListener("ended", release, { once: true });
    node.addEventListener("error", release, { once: true });
    void node.play().catch(release);
  }
}

interface AudioPreferences { music: number; effects: number; muted: boolean; }

const AUDIO_PREFERENCES_KEY = "slot-skills:audio";

function loadAudioPreferences(): AudioPreferences {
  try {
    const raw = localStorage.getItem(AUDIO_PREFERENCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioPreferences>;
      return {
        music: clamp(Number(parsed.music ?? 0.7), 0, 1),
        effects: clamp(Number(parsed.effects ?? 0.9), 0, 1),
        muted: Boolean(parsed.muted),
      };
    }
  } catch { /* Missing or blocked storage falls back to defaults. */ }
  return { music: 0.7, effects: 0.9, muted: false };
}

export class SlotGameElement extends HTMLElement {
  #game?: GameConfig;
  #transport: SlotTransport = new HttpSlotTransport();
  #playerId = "demo-player";
  #betUnits = "100";
  #catalog = new MessageCatalog("en", { spin: "Spin", balance: "Balance", win: "Win", paytable: "Paytable" });
  #busy = false;
  #autoplay = false;
  #collectPending: (() => void) | undefined;
  #choiceBusy = false;
  #manager?: EffectManager;
  #ambient: AmbientEffectRenderer | undefined;
  #ambientCanvas: HTMLCanvasElement | undefined;
  #resize?: ResizeObserver;
  #assetBaseUrl = document.baseURI;
  #images = new Map<string, HTMLImageElement>();
  #displayGrid: string[][] = [];
  #heldCells: boolean[][] | undefined;
  #spinState: ReelSpinState | undefined;
  #removalState: RemovalAnimation | undefined;
  #dropState: DropAnimation | undefined;
  #winningCells = new Set<string>();
  #winUntil = 0;
  #winMessageTimer: ReturnType<typeof setTimeout> | undefined;
  #frame = 0;
  #reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  #sounds = new SoundBank();
  #pendingCellEffects: Array<{ effect: EffectId; reel: number; row: number }> = [];
  #orbValues: Array<Array<number | undefined>> = [];
  #anteBet = false;
  #roundWinUnits = 0n;
  #music: HTMLAudioElement | undefined;
  #musicAssetId: string | undefined;
  #characterTimer: ReturnType<typeof setTimeout> | undefined;
  #characterPoseLockedUntil = 0;
  #fitViewport = false;
  #immersive = false;
  #fitListener: (() => void) | undefined;
  #syncCanvas: (() => void) | undefined;
  #audio: AudioPreferences = loadAudioPreferences();
  #configurationPreview: { symbolScale: number; frameScale: number; characterScale: number; characterOffsetX: number; characterOffsetY: number; ambientEffects: AmbientEffectConfig[] } | undefined;
  /** Optional frontend-only image registration. Keys remain existing symbol IDs. */
  symbolPresentation: Readonly<Record<string, SymbolImagePresentation>> = {};
  titleImageUrl: string | undefined;
  #presentationImages = new Map<string, HTMLImageElement>();
  get classicPresentation(): boolean { return this.getAttribute("presentation") === "classic"; }
  /** Static visual fixture only. Does not create a round or modify the game contract. */
  previewGrid(grid: readonly (readonly string[])[]): void {
    if (!this.hasAttribute("visual-preview")) throw new Error("previewGrid requires visual-preview");
    if (grid.length !== 5 || grid.some(column => column.length !== 3)) throw new Error("Visual fixture must be 5x3");
    this.#displayGrid = grid.map(column => [...column]); this.#updateAccessibleGrid();
  }
  /** CSS-pixel geometry for visual comparison, without exposing gameplay state. */
  presentationGeometry(): { glass: CellBox; cells: CellBox[][] } | undefined {
    const canvas = this.shadowRoot?.querySelector<HTMLCanvasElement>('.reel-canvas');
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    const project = (b: CellBox): CellBox => ({ x: rect.x + b.x * rect.width / canvas.width, y: rect.y + b.y * rect.height / canvas.height, width: b.width * rect.width / canvas.width, height: b.height * rect.height / canvas.height });
    return { glass: project(this.#reelArea(canvas.width, canvas.height)), cells: this.#gridShape().map((rows, reel) => Array.from({length:rows}, (_, row) => project(this.#cellBox(reel,row,canvas)))) };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  static get observedAttributes(): string[] { return ["fit", "chrome"]; }

  attributeChangedCallback(name: string): void {
    if (name === "fit") {
      this.#fitViewport = this.getAttribute("fit") === "viewport";
      this.#applyViewportFit();
    }
    if (name === "chrome") {
      const immersive = this.getAttribute("chrome") === "immersive";
      if (immersive !== this.#immersive) { this.#immersive = immersive; if (this.#game) this.render(); }
    }
  }

  /** Scale-to-fit mode: lay out at a fixed design width and letterbox-scale into the viewport. */
  set fitViewport(value: boolean) { if (value) this.setAttribute("fit", "viewport"); else this.removeAttribute("fit"); }
  get fitViewport(): boolean { return this.#fitViewport; }

  /** Immersive chrome: no card frame or marquee, taller reels, character in a side column; the host page provides the full-bleed background. */
  set immersive(value: boolean) { if (value) this.setAttribute("chrome", "immersive"); else this.removeAttribute("chrome"); }
  get immersive(): boolean { return this.#immersive; }

  set game(value: GameConfig) { this.#game = value; this.#configurationPreview = undefined; this.render(); }
  get game(): GameConfig | undefined { return this.#game; }
  set transport(value: SlotTransport) { this.#transport = value; }
  set playerId(value: string) { this.#playerId = value; }
  set betUnits(value: string) { this.#betUnits = value; this.#updateBet(); }
  get betUnits(): string { return this.#betUnits; }
  /** Quick-spin mode: reels settle with the same shortened timings free spins use. */
  turbo = false;
  /** Programmatic spin for host-page autoplay. Resolves when the round presentation completes; no-op while a spin is in flight. */
  spin(): Promise<void> { return this.#spin(); }
  set messages(value: MessageCatalog) { this.#catalog = value; this.render(); }
  set assetBaseUrl(value: string) { this.#assetBaseUrl = new URL(value, document.baseURI).href; if (this.#game) this.render(); }
  get assetBaseUrl(): string { return this.#assetBaseUrl; }
  /** Optional page-level canvas used for theme ambience. The host controls its stacking and bounds. */
  set ambientCanvas(value: HTMLCanvasElement | undefined) { if (this.#ambientCanvas === value) return; this.#ambientCanvas = value; if (this.#game && this.isConnected) this.render(); }
  get ambientCanvas(): HTMLCanvasElement | undefined { return this.#ambientCanvas; }

  previewConfiguration(value: { symbolScale: number; frameScale: number; characterScale: number; characterOffsetX: number; characterOffsetY: number; ambientEffects: readonly AmbientEffectConfig[] }): void {
    this.#configurationPreview = {
      symbolScale: clamp(value.symbolScale, 0.6, 1.4),
      frameScale: clamp(value.frameScale, 0.8, 1.3),
      characterScale: clamp(value.characterScale, 0.5, 1.8),
      characterOffsetX: clamp(value.characterOffsetX, -0.5, 0.5),
      characterOffsetY: clamp(value.characterOffsetY, -0.5, 0.5),
      ambientEffects: structuredClone([...value.ambientEffects]),
    };
    this.#configureAmbient();
    this.#applyCharacterPresentation();
  }

  clearConfigurationPreview(): void { this.#configurationPreview = undefined; this.#configureAmbient(); this.#applyCharacterPresentation(); }
  previewAmbientEffect(instanceId: string): void { this.#ambient?.trigger(instanceId); }

  connectedCallback(): void {
    this.#fitViewport = this.getAttribute("fit") === "viewport";
    this.#immersive = this.getAttribute("chrome") === "immersive";
    this.#fitListener = () => this.#applyViewportFit();
    window.addEventListener("resize", this.#fitListener);
    if (this.#game) this.render();
  }

  disconnectedCallback(): void { this.#manager?.destroy(); this.#ambient?.destroy(); this.#resize?.disconnect(); cancelAnimationFrame(this.#frame); this.#spinState?.resolve?.(); this.#removalState?.resolve?.(); this.#dropState?.resolve?.(); this.#heldCells = undefined; this.#music?.pause(); if (this.#characterTimer) clearTimeout(this.#characterTimer); if (this.#fitListener) { window.removeEventListener("resize", this.#fitListener); this.#fitListener = undefined; } }

  /**
   * Letterbox scaling: the component is laid out at FIT_DESIGN_WIDTH and transform-scaled so the
   * whole chrome (marquee, stage, console, extras) fits both viewport axes without page scrolling.
   * Below FIT_MIN_SCALE_WIDTH of available width the natural flow layout is kept, except for games
   * that explicitly require landscape presentation.
   */
  #applyViewportFit(): void {
    const root = this.shadowRoot?.querySelector<HTMLElement>(".game");
    if (!root) return;
    const reset = () => {
      root.classList.remove("fit");
      root.style.removeProperty("width"); root.style.removeProperty("transform"); root.style.removeProperty("transform-origin");
      this.style.removeProperty("width"); this.style.removeProperty("height"); this.style.removeProperty("margin");
    };
    if (!this.#fitViewport || this.classicPresentation) { reset(); this.#syncCanvas?.(); return; }
    const margin = Number(getComputedStyle(this).getPropertyValue("--fit-margin")) || 24;
    const availWidth = Math.max(0, this.parentElement?.clientWidth ?? window.innerWidth);
    const parentHeight = this.parentElement?.clientHeight ?? window.innerHeight;
    const availHeight = Math.max(0, Math.min(window.innerHeight, parentHeight) - margin * 2);
    const forceLandscape = this.#game?.layout.orientation === "landscape";
    if ((!forceLandscape && availWidth < FIT_MIN_SCALE_WIDTH) || !availHeight) { reset(); this.#syncCanvas?.(); return; }
    root.classList.add("fit");
    root.style.width = `${FIT_DESIGN_WIDTH}px`;
    root.style.transformOrigin = "top left";
    const naturalHeight = root.offsetHeight;
    if (!naturalHeight) { reset(); return; }
    const scale = Math.min(FIT_MAX_SCALE, availWidth / FIT_DESIGN_WIDTH, availHeight / naturalHeight);
    root.style.transform = `scale(${scale})`;
    this.style.width = `${Math.round(FIT_DESIGN_WIDTH * scale)}px`;
    this.style.height = `${Math.round(naturalHeight * scale)}px`;
    this.style.margin = "0 auto";
    this.#syncCanvas?.();
  }

  #asset(id: string): AssetEntry | undefined { return this.#game?.assets.find((asset) => asset.id === id); }
  #assetUrl(value: string | undefined): string { return value ? new URL(value, this.#assetBaseUrl).href : ""; }

  render(): void {
    if (!this.#game || !this.shadowRoot) return;
    const game = this.#game;
    this.#spinState?.resolve?.(); this.#removalState?.resolve?.(); this.#dropState?.resolve?.(); this.#spinState = undefined; this.#removalState = undefined; this.#dropState = undefined; this.#heldCells = undefined; this.#winningCells.clear(); this.#pendingCellEffects = [];
    cancelAnimationFrame(this.#frame); this.#manager?.destroy(); this.#ambient?.destroy(); this.#resize?.disconnect();
    const rows = this.#layoutRowCounts();
    this.#displayGrid = game.math.reelStrips?.map((strip, reel) => Array.from({ length: rows[reel] ?? 0 }, (_, row) => strip[row % strip.length]!))
      ?? Array.from({ length: game.layout.reels }, (_, reel) => Array.from({ length: rows[reel] ?? 0 }, (_, row) => game.symbols[(row + reel) % game.symbols.length]!.id));
    const background = game.assets.find((asset) => asset.role === "background");
    const backgroundStyle = background ? ` style="background-image:linear-gradient(#05081644,#05081677),url('${this.#assetUrl(background.path)}')"` : "";
    const characterHeight = clamp(game.presentation.characterHeight ?? 560, 200, 1200);
    const characterScale = clamp(this.#configurationPreview?.characterScale ?? game.presentation.characterScale ?? 1, 0.5, 1.8);
    const characterOffsetX = clamp(this.#configurationPreview?.characterOffsetX ?? game.presentation.characterOffsetX ?? 0, -0.5, 0.5);
    const characterOffsetY = clamp(this.#configurationPreview?.characterOffsetY ?? game.presentation.characterOffsetY ?? 0, -0.5, 0.5);
    const frameScale = clamp(game.presentation.frameScale ?? 1.07, 0.8, 1.3);
    // Padding baked below the character's feet: shift the image down by the same amount so the
    // feet, not the padded edge, sit on the reel-area bottom line.
    const characterBottomShift = Math.round(clamp(game.presentation.characterBottomMargin ?? 0, 0, 0.2) * characterHeight);
    const characterOverflow = this.#immersive && game.presentation.characterOverflow ? " character-overflow" : "";
    this.shadowRoot.innerHTML = `<style>${stylesheet}${bookStyles}</style><section class="game${this.#immersive ? " immersive" : ""}${characterOverflow}" style="--panel:${game.theme.palette[0]};--accent:${game.theme.palette[2] ?? game.theme.palette[1]};--character-height:${characterHeight}px;--character-bottom-shift:${characterBottomShift}px;--character-scale:${characterScale};--character-offset-x:${characterOffsetX * 100}%;--character-offset-y:${characterOffsetY * 100}%;--frame-scale:${frameScale}">
      <div class="marquee"><div class="brand"><small>Server-authoritative slot</small><h1 class="title">${game.title}</h1></div><div class="state" data-state="READY">READY</div></div>
      <div class="feature-strip" data-chips></div>
      <div class="error" role="alert" hidden></div><div class="stage-row"><div class="stage"${this.#immersive ? "" : backgroundStyle}><canvas class="reel-canvas" aria-label="${game.title} animated reels"></canvas><canvas class="effect-canvas"></canvas><svg class="payline-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>${this.#reelFrameMarkup()}<div class="float-layer"></div><div class="announce" role="status"><h3></h3><p hidden></p></div><div class="win-message" aria-live="polite"></div><div class="bonus" aria-live="polite"></div><div class="sr-grid" aria-live="polite"></div></div>${this.#characterMarkup()}</div>
      <div class="console cabinet">
        ${this.classicPresentation ? '<div class="cab-message">Please place your bet</div>' : ''}
        <div class="cab-meters">
          <div class="cab-meter"><small>Credit</small><strong data-credit>0.00</strong></div>
          <div class="cab-meter"><small>Lines</small><strong data-lines>${game.math.paylines?.length ?? 0}</strong></div>
          <div class="cab-meter"><small>Bet/Line</small><strong data-betline>${formatMinorUnits((BigInt(this.#betUnits) / BigInt(Math.max(1, game.math.paylines?.length ?? 1))).toString())}</strong></div>
          <div class="cab-meter"><small>Bet</small><strong data-bet>${formatMinorUnits(this.#betUnits)}</strong></div>
          <div class="cab-meter win-total"><small>${this.#catalog.format("win")}</small><output>0.00</output></div>
        </div>
        <div class="cab-deck">
          ${this.classicPresentation ? '<button class="cab-key" data-key="menu" type="button">Menu</button>' : ''}
          <button class="cab-key" data-key="autoplay" type="button">Autoplay</button>
          <button class="cab-key paytable" type="button">Paytable</button>
          <button class="cab-key" data-key="gamble" type="button" disabled>Gamble</button>
          <button class="spin cab-start" type="button"><svg class="spin-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M27 13a11 11 0 0 0-19-5L4 12m0-8v8h8M5 19a11 11 0 0 0 19 5l4-4m0 8v-8h-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="spin-label">Start</span></button>
        </div>
      </div>
      <div class="extras">${this.#featureEnabled("ante-bet") ? `<button class="toggle" data-ante aria-pressed="${this.#anteBet}">ANTE BET ×${this.#anteMultiplierLabel()}</button>` : ""}${this.#featureEnabled("bonus-buy") ? `<button class="buy" data-buy>BUY BONUS ×${this.#buyCostMultiplier()}</button>` : ""}<div class="audio"><button class="toggle" data-mute aria-pressed="${this.#audio.muted}">${this.#audio.muted ? "SOUND OFF" : "SOUND ON"}</button><label class="vol">Music<input type="range" data-music-vol min="0" max="100" value="${Math.round(this.#audio.music * 100)}" aria-label="Music volume"></label><label class="vol">Effects<input type="range" data-sfx-vol min="0" max="100" value="${Math.round(this.#audio.effects * 100)}" aria-label="Effects volume"></label></div></div>
      <dialog><button class="close" aria-label="Close paytable">×</button><h2>${game.title} paytable</h2><table><thead><tr><th>Symbol</th><th>Count</th><th>Payout</th></tr></thead><tbody>${paytableRows(game).map((entry) => `<tr><td>${entry.symbolName}</td><td>${entry.count}</td><td>${entry.payout.numerator}/${entry.payout.denominator} × ${entry.basis}</td></tr>`).join("")}</tbody></table></dialog>
    </section>`;
    this.#orbValues = []; this.#roundWinUnits = 0n;
    this.#updateAccessibleGrid(); this.#preloadAssets(); this.#preloadSounds();
    this.shadowRoot.querySelector<HTMLButtonElement>(".spin")!.addEventListener("click", () => { if (this.#collectPending) this.#collectPending(); else void this.#spin(); });
    this.shadowRoot.querySelector<HTMLButtonElement>('[data-key="autoplay"]')?.addEventListener("click", () => { this.#autoplay = !this.#autoplay; const button = this.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="autoplay"]')!; button.textContent = this.#autoplay ? "Stop" : "Autoplay"; if (this.#autoplay && !this.#busy) void this.#spin(); });
    this.shadowRoot.querySelector<HTMLButtonElement>("[data-ante]")?.addEventListener("click", () => this.#toggleAnte());
    this.shadowRoot.querySelector<HTMLButtonElement>("[data-buy]")?.addEventListener("click", () => void this.#spin("bonus-buy"));
    const character = this.shadowRoot.querySelector<HTMLImageElement>(".character");
    character?.addEventListener("error", () => {
      const fallback = this.#game?.assets.find((asset) => asset.role === "character" && asset.fallback)?.fallback;
      if (fallback && character.src !== this.#assetUrl(fallback)) character.src = this.#assetUrl(fallback);
    });
    const reelFrame = this.shadowRoot.querySelector<HTMLImageElement>(".reel-frame");
    reelFrame?.addEventListener("error", () => {
      const fallback = this.#game?.assets.find((asset) => asset.role === "reel-frame")?.fallback;
      if (fallback && reelFrame.src !== this.#assetUrl(fallback)) reelFrame.src = this.#assetUrl(fallback);
    });
    void installCharacterSpine(this, game).catch(() => undefined);
    this.shadowRoot.querySelector<HTMLButtonElement>("[data-mute]")?.addEventListener("click", () => { this.#audio.muted = !this.#audio.muted; this.#applyAudioPreferences(); });
    this.shadowRoot.querySelector<HTMLInputElement>("[data-music-vol]")?.addEventListener("input", (event) => { this.#audio = { ...this.#audio, music: clamp(Number((event.target as HTMLInputElement).value) / 100, 0, 1), muted: false }; this.#applyAudioPreferences(); });
    this.shadowRoot.querySelector<HTMLInputElement>("[data-sfx-vol]")?.addEventListener("input", (event) => { this.#audio = { ...this.#audio, effects: clamp(Number((event.target as HTMLInputElement).value) / 100, 0, 1), muted: false }; this.#applyAudioPreferences(); this.#playSound("reel-stop", 0.6); });
    this.#applyAudioPreferences();
    this.#updateExtras();
    if (this.classicPresentation) {
      for (const [index, label] of [[2, 'lines'], [3, 'bet per line']] as const) {
        const meter = this.shadowRoot.querySelector(`.cab-meter:nth-child(${index})`)!;
        for (const [text, action] of [['−', 'Decrease'], ['+', 'Increase']]) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'meter-adjust';
          button.textContent = text!; button.disabled = true; button.setAttribute('aria-label', `${action} ${label}`); meter.append(button);
        }
      }
    }
    if (this.hasAttribute("visual-preview")) {
      for (const button of this.shadowRoot.querySelectorAll<HTMLButtonElement>(".spin,[data-key=autoplay]")) button.disabled = true;
    }
    const dialog = this.shadowRoot.querySelector<HTMLDialogElement>("dialog")!;
    this.shadowRoot.querySelector<HTMLButtonElement>(".paytable")!.addEventListener("click", () => dialog.showModal());
    this.shadowRoot.querySelector<HTMLButtonElement>(".close")!.addEventListener("click", () => dialog.close());
    // Classic cabinet: MENU opens the same help/paytable surface as the paytable key.
    this.shadowRoot.querySelector<HTMLButtonElement>('[data-key="menu"]')?.addEventListener("click", () => dialog.showModal());
    const reelCanvas = this.shadowRoot.querySelector<HTMLCanvasElement>(".reel-canvas")!;
    const effectCanvas = this.shadowRoot.querySelector<HTMLCanvasElement>(".effect-canvas")!;
    const ambientCanvas = this.#ambientCanvas;
    const effectContext = effectCanvas.getContext("2d")!;
    this.#manager = new EffectManager(effectContext, { mode: "production", dpr: 1, reducedMotion: this.#reducedMotion, clearBeforeRender: true });
    this.#ambient = ambientCanvas ? new AmbientEffectRenderer(ambientCanvas, { mode: "production", reducedMotion: this.#reducedMotion }) : undefined;
    this.#configureAmbient();
    const sync = () => {
      const bounds = reelCanvas.getBoundingClientRect(); const dpr = devicePixelRatio || 1;
      const width = Math.max(1, Math.round(bounds.width * dpr)); const height = Math.max(1, Math.round(bounds.height * dpr));
      if (reelCanvas.width !== width || reelCanvas.height !== height) { reelCanvas.width = width; reelCanvas.height = height; }
      if (effectCanvas.width !== width || effectCanvas.height !== height) { effectCanvas.width = width; effectCanvas.height = height; }
      if (ambientCanvas) { const ambientBounds = ambientCanvas.getBoundingClientRect(); const ambientWidth = Math.max(1, Math.round(ambientBounds.width * dpr)); const ambientHeight = Math.max(1, Math.round(ambientBounds.height * dpr)); if (ambientCanvas.width !== ambientWidth || ambientCanvas.height !== ambientHeight) { ambientCanvas.width = ambientWidth; ambientCanvas.height = ambientHeight; } }
    };
    sync(); this.#resize = new ResizeObserver(sync); this.#resize.observe(reelCanvas); if (ambientCanvas) this.#resize.observe(ambientCanvas);
    this.#syncCanvas = sync;
    const tick = (now: number) => { if (!this.isConnected) return; this.#drawFrame(now); this.#ambient?.tick(now); this.#manager?.tick(now); this.#frame = requestAnimationFrame(tick); };
    this.#frame = requestAnimationFrame(tick);
    this.#applyViewportFit();
  }

  #layoutRowCounts(): number[] {
    if (!this.#game) return [];
    return Array.isArray(this.#game.layout.rows) ? [...this.#game.layout.rows] : Array(this.#game.layout.reels).fill(this.#game.layout.rows) as number[];
  }

  /** Current visible grid shape, following resized grids delivered by the server. */
  #gridShape(): number[] {
    const grid = this.#spinState?.target ?? this.#dropState?.toGrid ?? this.#displayGrid;
    if (grid.length) return grid.map((column) => column.length);
    return this.#layoutRowCounts();
  }

  #preloadAssets(): void {
    this.#images.clear();
    if (this.titleImageUrl) {
      const image = new Image();
      image.addEventListener("load", () => this.#images.set("$book-title", image));
      image.src = this.#assetUrl(this.titleImageUrl);
    }
    this.#presentationImages.clear();
    for (const [id, art] of Object.entries(this.symbolPresentation)) {
      const image = new Image(); image.src = this.#assetUrl(art.src);
      image.addEventListener("load", () => this.#presentationImages.set(id, image));
    }
    for (const asset of this.#game?.assets ?? []) {
      if (!asset.mediaType?.startsWith("image/")) continue;
      const image = new Image(); let usingFallback = false;
      image.addEventListener("load", () => { this.#images.set(asset.id, image); if (asset.role === "background") this.#ambient?.setSourceSize(image.naturalWidth, image.naturalHeight); });
      image.addEventListener("error", () => { if (!usingFallback && asset.fallback) { usingFallback = true; image.src = this.#assetUrl(asset.fallback); } });
      image.src = this.#assetUrl(asset.path);
    }
  }

  #preloadSounds(): void {
    for (const asset of this.#game?.assets ?? []) {
      if (asset.mediaType?.startsWith("audio/")) this.#sounds.register(asset.id, this.#assetUrl(asset.path));
    }
  }

  #applyCharacterPresentation(): void {
    const root = this.shadowRoot?.querySelector<HTMLElement>(".game");
    if (!root || !this.#game) return;
    const preview = this.#configurationPreview; const presentation = this.#game.presentation;
    root.style.setProperty("--character-scale", String(clamp(preview?.characterScale ?? presentation.characterScale ?? 1, 0.5, 1.8)));
    root.style.setProperty("--character-offset-x", `${clamp(preview?.characterOffsetX ?? presentation.characterOffsetX ?? 0, -0.5, 0.5) * 100}%`);
    root.style.setProperty("--character-offset-y", `${clamp(preview?.characterOffsetY ?? presentation.characterOffsetY ?? 0, -0.5, 0.5) * 100}%`);
    root.style.setProperty("--frame-scale", String(clamp(preview?.frameScale ?? presentation.frameScale ?? 1.07, 0.8, 1.3)));
  }

  #configureAmbient(): void {
    if (!this.#ambient || !this.#game) return;
    const background = this.#game.assets.find((asset) => asset.role === "background"); const image = background ? this.#images.get(background.id) : undefined;
    if (image?.naturalWidth) this.#ambient.setSourceSize(image.naturalWidth, image.naturalHeight);
    this.#ambient.configure(this.#configurationPreview?.ambientEffects ?? this.#game.theme.ambientEffects ?? [], this.#game.theme.palette);
  }

  #drawFrame(now: number): void {
    const canvas = this.shadowRoot?.querySelector<HTMLCanvasElement>(".reel-canvas"); const context = canvas?.getContext("2d");
    if (!canvas || !context || !this.#game) return;
    const width = canvas.width; const height = canvas.height; context.clearRect(0, 0, width, height);
    this.#drawBackground(context, width, height);
    const spin = this.#spinState;
    const reels = this.#gridShape().length;
    this.#drawCabinetFrame(context, width, height);
    for (let reel = 0; reel < reels; reel += 1) this.#drawReel(context, reel, now, spin);
    this.#drawCabinetFrame(context, width, height, true);
    if (spin?.target && spin.motions?.length) {
      const completedAt = Math.max(...spin.motions.map((motion) => motion.startTime + motion.duration));
      if (now >= completedAt) {
        // Presentation-only measurement hook: every reel's nominal landing time.
        if (spin.settleTimes) this.setAttribute("reel-settle-times", JSON.stringify(spin.settleTimes.map((value) => Math.round(value - spin.startedAt))));
        this.#displayGrid = spin.target.map((column) => [...column]); const resolve = spin.resolve; this.#spinState = undefined;
        this.#setState("READY"); this.#updateAccessibleGrid(); this.#playSound("reel-stop", 0.55); resolve?.();
      }
    }
    const removal = this.#removalState;
    if (removal && !removal.resolved && now >= removal.startedAt + removal.duration) { removal.resolved = true; removal.resolve?.(); }
    const drop = this.#dropState;
    if (drop && now >= drop.startedAt + drop.duration) { this.#displayGrid = drop.toGrid.map((column) => [...column]); this.#dropState = undefined; this.#updateAccessibleGrid(); drop.resolve?.(); }
    if (this.#winningCells.size && now >= this.#winUntil) this.#winningCells.clear();
  }

  #drawBackground(context: CanvasRenderingContext2D, width: number, height: number): void {
    if (this.#immersive) return;
    const background = this.#game?.assets.find((asset) => asset.role === "background"); const image = background ? this.#images.get(background.id) : undefined;
    context.save();
    if (image?.naturalWidth) {
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight); const drawWidth = image.naturalWidth * scale; const drawHeight = image.naturalHeight * scale;
      context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    } else { const fill = context.createLinearGradient(0, 0, width, height); fill.addColorStop(0, this.#game?.theme.palette[1] ?? "#16213a"); fill.addColorStop(1, this.#game?.theme.palette[0] ?? "#050812"); context.fillStyle = fill; context.fillRect(0, 0, width, height); }
    const shade = context.createRadialGradient(width * .5, height * .43, height * .05, width * .5, height * .5, width * .68); shade.addColorStop(0, "#101b3440"); shade.addColorStop(1, "#010207d9"); context.fillStyle = shade; context.fillRect(0, 0, width, height);
    context.restore();
  }

  /**
   * Cabinet furniture: flanking columns, payline chips, reel border, logo.
   *
   * Proportions follow the reference captures rather than invention. The space
   * either side of the reels carries ornate columns with the payline numbers as
   * coloured chips - mirrored left and right - and the reel window itself is
   * bordered by a thin gold line rather than a heavy bezel.
   *
   * Called twice per frame: the black reel bed first, then all the furniture.
   */
  #drawCabinetFrame(context: CanvasRenderingContext2D, width: number, height: number, overlay = false): void {
    if (this.classicPresentation) { drawBookCabinet(context, width, height, overlay, this.getAttribute("reference-state") ?? "", this.#images.get("$book-title")); return; }
    const palette = this.#game?.theme.palette ?? [];
    const accent = palette[2] ?? "#ffd34f";
    const area = this.#reelArea(width, height);

    if (!overlay) {
      context.save();
      context.fillStyle = "#000";
      context.fillRect(area.x - 2, area.y - 2, area.width + 4, area.height + 4);
      context.restore();
      return;
    }

    context.save();
    const colWidth = width * .07;
    this.#drawColumn(context, area.x - width * .008 - colWidth, area.y - height * .035, colWidth, area.height + height * .07, accent);
    this.#drawColumn(context, area.x + area.width + width * .008, area.y - height * .035, colWidth, area.height + height * .07, accent);

    // Reel separators: narrow ladders between the reels, as the reference has.
    const reelCount = Math.max(1, this.#gridShape().length);
    const step = area.width / reelCount;
    const ladder = Math.max(3, width * .0055);
    for (let index = 1; index < reelCount; index += 1) {
      const x = area.x + step * index - ladder / 2;
      context.fillStyle = "#8a1f14";
      context.fillRect(x, area.y, ladder, area.height);
      context.fillStyle = "#2f6fb0";
      const rung = Math.max(4, area.height * .022);
      for (let y = area.y + rung * .5; y < area.y + area.height - rung; y += rung * 2.1) {
        context.fillRect(x, y, ladder, rung);
      }
    }

    // Thin gold border around the glass.
    context.beginPath();
    context.rect(area.x - 2, area.y - 2, area.width + 4, area.height + 4);
    context.lineWidth = Math.max(2, width * .0035);
    context.strokeStyle = accent;
    context.stroke();

    this.#drawPaylineChips(context, width, height, area, colWidth);
    this.#drawTitlePlate(context, width, area.y);
    context.restore();
  }

  /** One ornate papyrus column: capital, fluted shaft, base. */
  #drawColumn(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, accent: string): void {
    const shaft = context.createLinearGradient(x, 0, x + w, 0);
    shaft.addColorStop(0, "#5d3b12");
    shaft.addColorStop(.18, "#c79a58");
    shaft.addColorStop(.42, "#ffe9a8");
    shaft.addColorStop(.68, "#b0812f");
    shaft.addColorStop(1, "#4a2d08");
    const cap = Math.max(10, h * .055);

    context.save();
    context.fillStyle = shaft;
    context.fillRect(x, y + cap, w, h - cap * 2);
    // Flutes.
    context.strokeStyle = "#00000055";
    context.lineWidth = Math.max(1, w * .03);
    for (let index = 1; index < 5; index += 1) {
      const fx = x + (w / 5) * index;
      context.beginPath();
      context.moveTo(fx, y + cap);
      context.lineTo(fx, y + h - cap);
      context.stroke();
    }
    // Capital and base flare.
    for (const ty of [y, y + h - cap]) {
      context.fillStyle = shaft;
      context.fillRect(x - w * .12, ty, w * 1.24, cap);
      context.strokeStyle = "#3a2409";
      context.lineWidth = Math.max(1, w * .035);
      context.strokeRect(x - w * .12, ty, w * 1.24, cap);
    }
    context.strokeStyle = accent;
    context.lineWidth = Math.max(1, w * .04);
    context.strokeRect(x, y + cap, w, h - cap * 2);
    context.restore();
  }

  /**
   * Payline numbers as coloured chips inside both columns, mirrored.
   * The reference uses one pastel per line so a lit line is identifiable.
   */
  #drawPaylineChips(context: CanvasRenderingContext2D, width: number, height: number, area: CellBox, colWidth: number): void {
    const count = this.#game?.math.paylines?.length ?? 0;
    if (!count) return;
    const swatches = ["#f5e04a", "#e8574f", "#a9d8f0", "#9ede5a", "#6fa8f5", "#f7b0a8", "#f5c98a", "#7ed957", "#f2a8d0", "#c9a8f0"];
    const chipW = colWidth * .62;
    const gap = area.height * .012;
    const chipH = (area.height - gap * (count - 1)) / count;
    const font = Math.max(8, chipH * .56);
    context.save();
    context.font = "900 " + font + "px ui-rounded, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lefts = [
      area.x - width * .008 - colWidth + (colWidth - chipW) / 2,
      area.x + area.width + width * .008 + (colWidth - chipW) / 2,
    ];
    for (const cx of lefts) {
      for (let index = 0; index < count; index += 1) {
        const y = area.y + index * (chipH + gap);
        context.fillStyle = swatches[index % swatches.length]!;
        context.fillRect(cx, y, chipW, chipH);
        context.strokeStyle = "#2a1708";
        context.lineWidth = Math.max(1, chipW * .04);
        context.strokeRect(cx, y, chipW, chipH);
        context.fillStyle = "#1a1005";
        context.fillText(String(index + 1), cx + chipW / 2, y + chipH / 2 + font * .04);
      }
    }
    context.restore();
  }

  /** The logo strip above the glass, sized to the reference's ~21% of width. */
  #drawTitlePlate(context: CanvasRenderingContext2D, width: number, reelTop: number): void {
    const title = (this.#game?.title ?? "").toUpperCase();
    if (!title) return;
    const bandCentre = reelTop * .46;
    let size = Math.min(width * .050, reelTop * .40);
    if (size < 10) return;

    context.save();
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "900 " + size + "px Georgia, \"Times New Roman\", serif";
    // Keep the lockup near the reference's 21% of frame width.
    const target = width * .30;
    const natural = context.measureText(title).width;
    if (natural > target) {
      size = size * (target / natural);
      context.font = "900 " + size + "px Georgia, \"Times New Roman\", serif";
    }

    const gold = context.createLinearGradient(0, bandCentre - size, 0, bandCentre + size);
    gold.addColorStop(0, "#fff6d6");
    gold.addColorStop(.42, "#f0c75e");
    gold.addColorStop(.72, "#c9922a");
    gold.addColorStop(1, "#6b430a");

    context.lineJoin = "round";
    context.lineWidth = size * .3;
    context.strokeStyle = "#1c2f6b";
    context.strokeText(title, width / 2, bandCentre);
    context.lineWidth = size * .12;
    context.strokeStyle = "#2a1708";
    context.strokeText(title, width / 2, bandCentre);
    context.fillStyle = gold;
    context.fillText(title, width / 2, bandCentre);
    context.restore();
  }


  #reelArea(width: number, height: number): CellBox {
    if (this.classicPresentation) {
      const gambleReference = this.getAttribute("reference-state") === "06-gamble";
      const scale = gambleReference ? .754 : 1, inset = gambleReference ? 137 : 0;
      return { x: width * (inset + 97 * scale) / 1112, y: height * 113 / 630, width: width * 940 * scale / 1112, height: height * 429 / 630 };
    }
    if (this.#immersive) return { x: width * .168, y: height * .180, width: width * .687, height: height * .757 };
    return { x: width * .045, y: height * CARD_REEL_INSET, width: width * .91, height: height * (1 - 2 * CARD_REEL_INSET) };
  }

  #cellBox(reel: number, row: number, canvas?: HTMLCanvasElement): CellBox {
    const target = canvas ?? this.shadowRoot!.querySelector<HTMLCanvasElement>(".reel-canvas")!; const area = this.#reelArea(target.width, target.height); const rows = this.#gridShape(); const reelCount = Math.max(1, rows.length); const maxRows = Math.max(1, ...rows); const gutter = Math.max(3, target.width * .006); const reelWidth = area.width / reelCount; const cellHeight = area.height / maxRows; const columnRows = rows[reel] ?? maxRows; const offset = (maxRows - columnRows) * cellHeight / 2;
    return { x: area.x + reel * reelWidth + gutter / 2, y: area.y + offset + row * cellHeight + gutter / 2, width: reelWidth - gutter, height: cellHeight - gutter };
  }

  #drawReel(context: CanvasRenderingContext2D, reel: number, now: number, spin?: ReelSpinState): void {
    const canvas = context.canvas; const rows = this.#gridShape(); const count = rows[reel] ?? 0; if (!count) return;
    const first = this.#cellBox(reel, 0, canvas); const last = this.#cellBox(reel, Math.max(0, count - 1), canvas); const clip = { x: first.x, y: first.y, width: first.width, height: last.y + last.height - first.y };
    context.save(); context.beginPath(); context.roundRect(clip.x, clip.y, clip.width, clip.height, 2); context.clip(); const bed = context.createLinearGradient(clip.x, clip.y, clip.x, clip.y + clip.height); bed.addColorStop(0, "#070604"); bed.addColorStop(.5, "#010101"); bed.addColorStop(1, "#070604"); context.fillStyle = this.classicPresentation ? "#000" : bed; context.fillRect(clip.x, clip.y, clip.width, clip.height);
    const motion = spin?.motions?.[reel]; const landing = motion && now >= motion.startTime ? sampleReelMotion(motion, now) : undefined; const isMoving = Boolean(spin && !landing?.complete);
    if (isMoving && spin) {
      const ids = this.#game!.symbols.map((symbol) => symbol.id); const speed = .012 + reel * .00075; const position = landing?.position ?? Math.max(0, now - spin.startedAt) * speed; const velocity = landing?.velocity ?? speed; const whole = Math.floor(position); const fraction = position - whole; const strip = landing && motion ? motion.strip : undefined;
      if (spin.settleTimes) spin.settleTimes[reel] = Math.max(spin.settleTimes[reel] ?? 0, motion ? motion.startTime + motion.duration : Math.round(now));
      context.save(); context.filter = `blur(${clamp(velocity * 1000 / 18) * 3.6 * (devicePixelRatio || 1)}px)`;
      // Reference reels roll downward: new symbols enter at the top and leave at
      // the bottom. Reverse both strip indexing and the visual offset so the
      // motion remains continuous while the server result stays authoritative.
      for (let row = -1; row <= count + 1; row += 1) { const index = whole - row; const symbolId = strip ? strip[(index % strip.length + strip.length) % strip.length]! : ids[(index + reel * 3 + ids.length * 100) % ids.length]!; const box = this.#cellBox(reel, 0, canvas); box.y = first.y + (row + fraction) * (first.height + Math.max(3, canvas.width * .006)); this.#drawSymbol(context, symbolId, box, false, now); }
      context.restore();
      for (let row = 0; row < count; row += 1) {
        if (!spin.heldCells?.[reel]?.[row]) continue;
        const symbolId = this.#displayGrid[reel]?.[row] ?? this.#game!.symbols[0]!.id;
        this.#drawSymbol(context, symbolId, this.#cellBox(reel, row, canvas), false, now);
      }
    } else if (!spin && this.#dropState) {
      this.#drawDroppingReel(context, reel, count, now, this.#dropState);
    } else {
      const grid = spin?.target ?? this.#displayGrid; const removal = !spin ? this.#removalState : undefined; const removalProgress = removal ? (removal.duration ? clamp((now - removal.startedAt) / removal.duration) : 1) : 0;
      for (let row = 0; row < count; row += 1) {
        const symbolId = grid[reel]?.[row] ?? this.#game!.symbols[0]!.id; const box = this.#cellBox(reel, row, canvas); const removing = removal?.cells.has(`${reel}:${row}`) ?? false;
        if (removing && removalProgress >= 1) continue;
        if (removing) { const scale = 1 - removalProgress; context.save(); context.globalAlpha = 1 - removalProgress; context.translate(box.x + box.width / 2, box.y + box.height / 2); context.scale(scale, scale); context.translate(-(box.x + box.width / 2), -(box.y + box.height / 2)); this.#drawSymbol(context, symbolId, box, true, now); context.restore(); }
        else {
          this.#drawSymbol(context, symbolId, box, this.#winningCells.has(`${reel}:${row}`), now);
          // JSON transport turns the engine's undefined cells into null - only real values get a badge.
          const orbValue = this.#orbValues[reel]?.[row];
          if (typeof orbValue === "number" && orbValue > 0) this.#drawOrbBadge(context, box, orbValue);
        }
      }
    }
    context.restore();
  }

  #drawDroppingReel(context: CanvasRenderingContext2D, reel: number, count: number, now: number, drop: DropAnimation): void {
    const progress = clamp((now - drop.startedAt) / drop.duration); const eased = 1 - Math.pow(1 - progress, 3); const oldColumn = drop.fromGrid[reel] ?? []; const newColumn = drop.toGrid[reel] ?? []; const survivors = oldColumn.map((symbolId, row) => ({ symbolId, row })).filter(({ row }) => !drop.removedCells.has(`${reel}:${row}`)); const incomingCount = Math.max(0, newColumn.length - survivors.length); const first = this.#cellBox(reel, 0, context.canvas); const step = first.height + Math.max(3, context.canvas.width * .006);
    context.save(); context.filter = `blur(${(1 - eased) * 1.4 * (devicePixelRatio || 1)}px)`;
    for (let row = 0; row < count; row += 1) { const survivor = row >= incomingCount ? survivors[row - incomingCount] : undefined; const fromRow = survivor?.row ?? row - incomingCount; const box = this.#cellBox(reel, row, context.canvas); box.y += (fromRow - row) * step * (1 - eased); this.#drawSymbol(context, newColumn[row] ?? this.#game!.symbols[0]!.id, box, false, now); }
    context.restore();
  }

  #drawSymbol(context: CanvasRenderingContext2D, symbolId: string, box: CellBox, winner: boolean, now: number): void {
    const art = this.symbolPresentation[symbolId], replacement = this.#presentationImages.get(symbolId);
    if (art && replacement) {
      context.save(); context.beginPath(); context.rect(box.x, box.y, box.width, box.height); context.clip();
      const unit = Math.min(box.width / 180, box.height / 166);
      const w = art.width * unit * art.scale, h = art.height * unit * art.scale;
      const x = box.x + box.width / 2 - w * art.anchorX + art.offsetX * unit;
      const y = box.y + box.height / 2 - h * art.anchorY + art.offsetY * unit;
      if (winner) { context.shadowColor = '#ffe961'; context.shadowBlur = 15; }
      if (art.crop) context.drawImage(replacement, art.crop.x, art.crop.y, art.crop.width, art.crop.height, x, y, w, h);
      else context.drawImage(replacement, x, y, w, h);
      context.restore(); return;
    }
    const symbol = this.#game?.symbols.find((candidate) => candidate.id === symbolId); const asset = symbol ? this.#asset(symbol.asset) : undefined; const image = asset ? this.#images.get(asset.id) : undefined; const radius = 0; const pulse = winner ? .5 + .5 * Math.sin(now / 90) : 0;
    context.save(); context.beginPath(); context.roundRect(box.x, box.y, box.width, box.height, radius); context.clip();
    if (winner) { const fill = context.createRadialGradient(box.x + box.width * .5, box.y + box.height * .45, 0, box.x + box.width * .5, box.y + box.height * .5, Math.max(box.width, box.height) * .7); fill.addColorStop(0, `rgba(255,221,91,${.3 + pulse * .2})`); fill.addColorStop(1, "rgba(255,170,40,0)"); context.fillStyle = fill; context.fillRect(box.x, box.y, box.width, box.height); }
    const symbolScale = clamp(this.#configurationPreview?.symbolScale ?? this.#game?.presentation.symbolScale ?? 1, 0.6, 1.4);
    if (image?.naturalWidth) { const inset = Math.min(box.width, box.height) * .03; const availableWidth = box.width - inset * 2; const availableHeight = box.height - inset * 2; const scale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight) * symbolScale; const drawWidth = image.naturalWidth * scale; const drawHeight = image.naturalHeight * scale; context.shadowColor = winner ? "#ffe46b" : "#000b"; context.shadowBlur = winner ? 24 + pulse * 18 : 9; context.drawImage(image, box.x + (box.width - drawWidth) / 2, box.y + (box.height - drawHeight) / 2, drawWidth, drawHeight); }
    else { context.fillStyle = "#dbe6ff"; context.font = `800 ${Math.max(10, box.width * .12 * symbolScale)}px system-ui`; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(symbol?.name ?? symbolId, box.x + box.width / 2, box.y + box.height / 2, box.width * .82); }
    if (winner) { context.strokeStyle = `rgba(255,224,91,${.72 + pulse * .28})`; context.lineWidth = Math.max(3, box.width * .025); context.strokeRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2); } context.restore();
  }

  #startReelSpin(heldCells?: boolean[][]): void {
    this.#spinState?.resolve?.(); this.#removalState?.resolve?.(); this.#dropState?.resolve?.(); this.#removalState = undefined; this.#dropState = undefined; this.#spinState = { startedAt: performance.now() }; this.#winningCells.clear(); this.#hideWin(); this.#setState("SPINNING"); this.#playSound("spin-start", 0.5);
    this.#heldCells = heldCells?.map((column) => [...column]);
    if (heldCells) this.#spinState.heldCells = heldCells.map((column) => [...column]);
  }

  #settleReels(grid: string[][], quick = false, heldCells?: boolean[][]): Promise<void> {
    if (this.#reducedMotion) { this.#displayGrid = grid.map((column) => [...column]); this.#spinState = undefined; this.#updateAccessibleGrid(); this.#setState("READY"); return Promise.resolve(); }
    if (!this.#spinState) this.#startReelSpin(heldCells);
    const state = this.#spinState!; if (heldCells) state.heldCells = heldCells.map((column) => [...column]); else delete state.heldCells; state.target = grid.map((column) => [...column]); const ids = this.#game!.symbols.map((symbol) => symbol.id);
    const settleDelay = quick ? 140 : 680; const stagger = quick ? 55 : 115; const duration = quick ? 480 : 780;
    const stopBase = Math.max(performance.now() + 90, state.startedAt + settleDelay);
    state.settleTimes = state.target.map((_, reel) => stopBase + reel * stagger + duration);
    state.motions = state.target.map((column, reel) => {
      const entryVelocity = .012 + reel * .00075; const startTime = stopBase + reel * stagger; const startPosition = Math.max(0, startTime - state.startedAt) * entryVelocity; const targetPosition = Math.max(Math.ceil(startPosition) + 3, Math.floor(startPosition + entryVelocity * duration * .58)); const distance = targetPosition - startPosition; const stripLength = targetPosition + column.length + ids.length + 2;
      const strip = Array.from({ length: stripLength }, (_, index) => ids[(index + reel * 3) % ids.length]!); for (let row = 0; row < column.length; row += 1) strip[targetPosition + row] = column[row]!;
      return { strip, startTime, duration, startPosition, targetPosition, distance, entryVelocity };
    }); this.#setState("STOPPING");
    return new Promise((resolve) => { state.resolve = resolve; });
  }

  #animateRemoval(cells: Array<{ reel: number; row: number }>): Promise<void> {
    this.#removalState?.resolve?.(); const state: RemovalAnimation = { cells: new Set(cells.map((cell) => `${cell.reel}:${cell.row}`)), startedAt: performance.now(), duration: this.#reducedMotion ? 0 : 240, resolved: this.#reducedMotion }; this.#removalState = state; this.#setState("CASCADE"); if (this.#reducedMotion) return Promise.resolve(); return new Promise((resolve) => { state.resolve = resolve; });
  }

  #animateDrop(grid: string[][]): Promise<void> {
    const removedCells = this.#removalState?.cells ?? new Set<string>(); this.#removalState = undefined; this.#winningCells.clear();
    if (this.#reducedMotion) { this.#displayGrid = grid.map((column) => [...column]); this.#updateAccessibleGrid(); return Promise.resolve(); }
    this.#dropState?.resolve?.(); const state: DropAnimation = { fromGrid: this.#displayGrid.map((column) => [...column]), toGrid: grid.map((column) => [...column]), removedCells: new Set(removedCells), startedAt: performance.now(), duration: 380 }; this.#dropState = state; this.#setState("CASCADE"); return new Promise((resolve) => { state.resolve = resolve; });
  }

  #cancelSpin(): void { const resolve = this.#spinState?.resolve; this.#spinState = undefined; this.#removalState?.resolve?.(); this.#dropState?.resolve?.(); this.#removalState = undefined; this.#dropState = undefined; this.#heldCells = undefined; this.#setState("READY"); resolve?.(); }
  #setState(value: "READY" | "SPINNING" | "STOPPING" | "CASCADE" | "WIN" | "FEATURE"): void { const state = this.shadowRoot?.querySelector<HTMLElement>(".state"); if (state) { state.dataset.state = value; state.textContent = value; } this.toggleAttribute("reels-moving", value === "SPINNING" || value === "STOPPING"); }
  #updateBet(): void { const bet = this.shadowRoot?.querySelector<HTMLElement>("[data-bet]"); if (bet) bet.textContent = formatMinorUnits(this.#anteBet ? this.#anteCostUnits() : this.#betUnits); }

  #feature(id: string) { return this.#game?.features.find((feature) => feature.id === id && feature.enabled); }
  #featureEnabled(id: string): boolean { return Boolean(this.#feature(id)); }

  #featureNumber(id: string, key: string, fallback: number): number {
    const value = this.#feature(id)?.config?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  #anteCostUnits(): string {
    const bps = Math.max(10000, Math.floor(this.#featureNumber("ante-bet", "stakeMultiplierBps", 12500)));
    return (BigInt(this.#betUnits) * BigInt(bps) / 10000n).toString();
  }

  #anteMultiplierLabel(): string { return (Math.max(10000, Math.floor(this.#featureNumber("ante-bet", "stakeMultiplierBps", 12500))) / 10000).toFixed(2).replace(/0$/, ""); }
  #buyCostMultiplier(): number { return Math.max(1, Math.floor(this.#featureNumber("bonus-buy", "costMultiplier", 100))); }

  #toggleAnte(): void {
    if (this.#busy) return;
    this.#anteBet = !this.#anteBet;
    this.#updateBet();
    this.#updateExtras();
  }

  /** Ante bet and bonus buy are mutually exclusive: the ante toggle disables the buy button and vice versa. */
  #updateExtras(): void {
    const ante = this.shadowRoot?.querySelector<HTMLButtonElement>("[data-ante]");
    const buy = this.shadowRoot?.querySelector<HTMLButtonElement>("[data-buy]");
    if (ante) ante.setAttribute("aria-pressed", String(this.#anteBet));
    if (buy) buy.disabled = this.#anteBet || this.#busy;
    if (ante) ante.disabled = this.#busy;
  }

  #characterMarkup(): string {
    const idle = this.#game?.assets.find((asset) => asset.role === "character");
    if (!idle) return "";
    return `<div class="character-slot"><img class="character" data-pose="idle" alt="" src="${this.#assetUrl(idle.path)}"></div>`;
  }

  #reelFrameMarkup(): string {
    const frame = this.#game?.assets.find((asset) => asset.role === "reel-frame");
    if (!frame) return "";
    return `<img class="reel-frame" aria-hidden="true" alt="" src="${this.#assetUrl(frame.path)}">`;
  }

  #setCharacterPose(pose: string, fallbackDurationMs = 2400): void {
    const character = this.shadowRoot?.querySelector<HTMLImageElement>(".character");
    if (!character || !this.#game) return;
    const now = performance.now();
    const remainingLockMs = remainingCharacterPoseLockMs(character.dataset.pose, this.#characterPoseLockedUntil, now);
    if (remainingLockMs > 0) {
      if (this.#characterTimer) clearTimeout(this.#characterTimer);
      this.#characterTimer = setTimeout(() => this.#setCharacterPose(pose, fallbackDurationMs), Math.ceil(remainingLockMs));
      return;
    }
    const characters = this.#game.assets.filter((asset) => asset.role === "character");
    const wanted = characters.find((asset) => asset.id.endsWith(`-${pose}`) || asset.id === pose) ?? characters[0];
    if (!wanted) return;
    character.dataset.pose = pose;
    character.src = this.#assetUrl(wanted.path);
    if (this.#characterTimer) clearTimeout(this.#characterTimer);
    this.#characterTimer = undefined;
    if (pose === "idle") {
      this.#characterPoseLockedUntil = 0;
      return;
    }
    const durationMs = characterAnimationDurationMs(wanted, this.#reducedMotion ? 400 : fallbackDurationMs);
    this.#characterPoseLockedUntil = now + durationMs;
    this.#characterTimer = setTimeout(() => this.#setCharacterPose("idle"), durationMs);
  }

  #setMappedCharacterPose(trigger: Parameters<typeof mappedCharacterAnimation>[1], fallbackDurationMs = 2400): boolean {
    if (!this.#game) return false;
    const animationId = mappedCharacterAnimation(this.#game, trigger);
    if (!animationId) return false;
    this.#setCharacterPose(animationId, fallbackDurationMs);
    return true;
  }

  /** Starts or switches the looping background-music track; browsers require a user gesture first. */
  #playMusic(kind: "base" | "bonus"): void {
    const tracks = this.#game?.assets.filter((asset) => asset.role === "background-music") ?? [];
    if (!tracks.length) return;
    const wanted = tracks.find((asset) => asset.id.includes(kind)) ?? tracks[0]!;
    if (this.#musicAssetId === wanted.id && this.#music && !this.#music.paused) { this.#applyAudioPreferences(); return; }
    this.#music?.pause();
    const node = new Audio(this.#assetUrl(wanted.path));
    node.loop = true;
    node.volume = this.#audio.muted ? 0 : this.#audio.music;
    this.#music = node;
    this.#musicAssetId = wanted.id;
    void node.play().catch(() => { this.#musicAssetId = undefined; });
  }

  /** Pushes the current audio preferences to the live music element, the SFX bank, and the controls. */
  #applyAudioPreferences(): void {
    if (this.#music) this.#music.volume = this.#audio.muted ? 0 : this.#audio.music;
    this.#sounds.master = this.#audio.muted ? 0 : this.#audio.effects;
    const mute = this.shadowRoot?.querySelector<HTMLButtonElement>("[data-mute]");
    if (mute) { mute.setAttribute("aria-pressed", String(this.#audio.muted)); mute.textContent = this.#audio.muted ? "SOUND OFF" : "SOUND ON"; }
    try { localStorage.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(this.#audio)); } catch { /* Blocked storage keeps in-session preferences only. */ }
  }

  #drawOrbBadge(context: CanvasRenderingContext2D, box: CellBox, value: number): void {
    const label = `×${value}`;
    context.save();
    const badgeHeight = Math.max(14, box.height * .3);
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height * .68;
    context.font = `950 ${badgeHeight * .62}px ui-rounded, system-ui`;
    context.textAlign = "center"; context.textBaseline = "middle";
    const badgeWidth = Math.max(context.measureText(label).width + badgeHeight * .8, badgeHeight * 1.4);
    context.beginPath(); context.roundRect(centerX - badgeWidth / 2, centerY - badgeHeight / 2, badgeWidth, badgeHeight, badgeHeight / 2);
    context.fillStyle = "rgba(10,6,26,.88)"; context.fill();
    context.strokeStyle = "#ffd34f"; context.lineWidth = Math.max(1.5, badgeHeight * .08); context.stroke();
    context.fillStyle = "#ffe9a8";
    context.shadowColor = "#ffd34f"; context.shadowBlur = badgeHeight * .4;
    context.fillText(label, centerX, centerY);
    context.restore();
  }

  #updateAccessibleGrid(): void {
    const root = this.shadowRoot?.querySelector<HTMLElement>(".sr-grid"); if (!root || !this.#game) return;
    root.textContent = this.#displayGrid.map((column, reel) => `Reel ${reel + 1}: ${column.map((id) => this.#game!.symbols.find((symbol) => symbol.id === id)?.name ?? id).join(", ")}`).join(". ");
  }

  #pause(ms: number): Promise<void> { return this.#reducedMotion || ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms)); }

  #playSound(key: string, volume = 0.8): void {
    const assetId = this.#game?.theme.sounds?.[key] ?? (this.#asset(`sfx-${key}`) ? `sfx-${key}` : undefined);
    if (assetId && this.#asset(assetId)) this.#sounds.play(assetId, volume);
  }

  #stageBounds(): CellBox {
    const canvas = this.shadowRoot?.querySelector<HTMLCanvasElement>(".effect-canvas");
    return { x: 0, y: 0, width: canvas?.width ?? 0, height: canvas?.height ?? 0 };
  }

  #playEffect(id: string | undefined, box?: CellBox, options: EffectOptions = {}): void {
    if (!id || !this.#manager || !effectIds.includes(id as EffectId)) return;
    const metadata = effectRegistry[id as EffectId]?.metadata;
    if (!metadata) return;
    const bounds = box ?? this.#stageBounds();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const preferred: EffectTargetKind[] = box ? ["symbol", "reel", "overlay", "button", "background"] : ["overlay", "background", "reel", "symbol", "button"];
    const kind = preferred.find((candidate) => metadata.targets.includes(candidate)) ?? metadata.targets[0];
    if (!kind) return;
    this.#manager.play(id as EffectId, fixedTarget(kind, bounds.x, bounds.y, bounds.width, bounds.height, Boolean(box)), { durationMs: 850, intensity: .9, ...options });
  }

  #eventEffect(event: GameEvent): EffectId | undefined {
    return configuredEventEffect(this.#game?.theme.effects, event.type);
  }

  #reelBox(reel: number): CellBox {
    const rows = this.#gridShape()[reel] ?? 1;
    const top = this.#cellBox(reel, 0);
    const bottom = this.#cellBox(reel, Math.max(0, rows - 1));
    return { x: top.x, y: top.y, width: top.width, height: bottom.y + bottom.height - top.y };
  }

  #announce(title: string, subtitle = "", tone = "", ms = 1250): Promise<void> {
    const banner = this.shadowRoot?.querySelector<HTMLElement>(".announce");
    if (!banner) return Promise.resolve();
    banner.querySelector("h3")!.textContent = title;
    const detail = banner.querySelector("p")!;
    detail.hidden = !subtitle; detail.textContent = subtitle;
    if (tone) banner.dataset.tone = tone; else delete banner.dataset.tone;
    banner.classList.add("active");
    const hold = this.#reducedMotion ? 350 : ms;
    return new Promise((resolve) => setTimeout(() => { banner.classList.remove("active"); resolve(); }, hold));
  }

  #floatPrize(text: string, tone = "#9dffc2"): void {
    const layer = this.shadowRoot?.querySelector<HTMLElement>(".float-layer");
    if (!layer) return;
    const node = document.createElement("span");
    node.className = "float-prize";
    node.style.color = tone;
    node.style.left = `${42 + Math.random() * 16}%`;
    node.textContent = text;
    layer.append(node);
    setTimeout(() => node.remove(), this.#reducedMotion ? 400 : 1300);
  }

  #chip(key: string, label: string, value: string): void {
    const strip = this.shadowRoot?.querySelector<HTMLElement>("[data-chips]");
    if (!strip) return;
    let chip = strip.querySelector<HTMLElement>(`[data-chip="${key}"]`);
    if (!chip) { chip = document.createElement("span"); chip.className = "chip"; chip.dataset.chip = key; strip.append(chip); }
    chip.innerHTML = `${label} <strong></strong>`;
    chip.querySelector("strong")!.textContent = value;
    chip.classList.remove("bump"); void chip.offsetWidth; chip.classList.add("bump");
  }

  #clearChips(): void { this.shadowRoot?.querySelector("[data-chips]")?.replaceChildren(); }

  #clearPaylines(): void { const overlay = this.shadowRoot?.querySelector<SVGElement>(".payline-overlay"); if (overlay) { overlay.replaceChildren(); overlay.classList.remove("active"); } }

  #showPayline(cells: Array<{ reel: number; row: number }>): void {
    const overlay = this.shadowRoot?.querySelector<SVGSVGElement>(".payline-overlay");
    if (!overlay || cells.length < 2) return;
    const points = cells.map((cell) => { const box = this.#cellBox(cell.reel, cell.row); const stage = this.shadowRoot!.querySelector<HTMLElement>(".stage")!.getBoundingClientRect(); return `${((box.x + box.width / 2) / stage.width) * 100},${((box.y + box.height / 2) / stage.height) * 100}`; }).join(" ");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); line.setAttribute("points", points); overlay.append(line); overlay.classList.add("active");
    setTimeout(() => overlay.classList.remove("active"), 1300);
  }

  #flushCellEffects(): void {
    const pending = this.#pendingCellEffects; this.#pendingCellEffects = [];
    pending.forEach((entry, index) => {
      const delay = this.#reducedMotion ? 0 : index * 70;
      setTimeout(() => this.#playEffect(entry.effect, this.#cellBox(entry.reel, entry.row), { durationMs: 950, seed: index + 3 }), delay);
    });
    if (pending.length) this.#playSound("symbol-transform", 0.6);
  }

  async #spin(purchasedFeatureId?: string): Promise<void> {
    if (!this.#game || this.#busy || this.#collectPending || this.#choiceBusy) return;
    if (purchasedFeatureId && this.#anteBet) return;
    this.#busy = true; const button = this.shadowRoot!.querySelector<HTMLButtonElement>(".spin")!; button.disabled = true; this.#clearChips(); this.#clearPaylines(); this.#updateExtras(); this.#playMusic("base"); this.#roundWinUnits = 0n; this.#orbValues = []; this.#startReelSpin();
    try {
      const result = await this.#transport.spin({
        gameId: this.#game.id, playerId: this.#playerId, betUnits: this.#betUnits, idempotencyKey: crypto.randomUUID(), autoplay: this.#autoplay,
        ...(purchasedFeatureId ? { purchasedFeatureId } : {}),
        ...(this.#anteBet ? { anteBet: true } : {}),
      });
      await this.playResult(result);
    }
    catch (error) { this.#cancelSpin(); this.#reportError(error, "spin"); }
    finally { this.#busy = false; button.disabled = this.#choiceBusy; this.#updateExtras(); if (this.#autoplay && !this.#collectPending && this.isConnected) setTimeout(() => { if (this.#autoplay && !this.#busy) void this.#spin(); }, 650); }
  }

  async playResult(result: GameRoundResult): Promise<void> {
    if (!this.#game) throw new Error("A game must be assigned before playing a result");
    if (!this.#spinState && result.events.some((event) => event.type === "grid-reveal")) this.#startReelSpin();
    try {
      for (const event of result.events) { await this.#playEvent(event, result); this.dispatchEvent(new CustomEvent<SlotEventPlayedEventDetail>("slot-event-played", { detail: { event, result }, bubbles: true, composed: true })); }
      this.shadowRoot!.querySelector<HTMLOutputElement>("output")!.value = formatMinorUnits(result.totalWinUnits);
      if (result.roundState === "FREE_GAME_INTRO" || result.roundState === "FREE_GAME_ACTIVE") this.#setState("FEATURE");
      else if (result.roundState === "GAMBLE_PENDING") this.#setState("FEATURE");
      if (BigInt(result.totalWinUnits) > 0n && result.complete) this.#showWin(result.totalWinUnits);
      else if (!result.pendingAction) this.#setState("READY");
      if (result.pendingAction) this.#openBonus(result);
      this.dispatchEvent(new CustomEvent<SlotRoundResultEventDetail>("slot-round-result", { detail: { result }, bubbles: true, composed: true }));
    } catch (error) { this.#cancelSpin(); this.#reportError(error, "playback"); throw error; }
  }

  async #playEvent(event: GameEvent, result: GameRoundResult): Promise<void> {
    const data = event.data;
    const grid = data.grid as string[][] | undefined;
    const featureId = typeof data.featureId === "string" ? data.featureId : undefined;
    const inFreeSpins = data.freeSpinIndex !== undefined;
    switch (event.type) {
      case "round-start":
        if (data.freeSpin !== undefined) {
          this.#setState("FEATURE");
          this.#chip("free-spins", "Free spins", String(data.freeSpin));
        }
        break;
      case "grid-reveal": {
        if (grid) {
          if (!this.#spinState) this.#startReelSpin();
          this.#orbValues = [];
          await this.#settleReels(grid, inFreeSpins || this.turbo);
          if (Array.isArray(data.orbValues)) this.#orbValues = data.orbValues as Array<Array<number | undefined>>;
          this.#flushCellEffects();
        }
        break;
      }
      case "symbol-transform": {
        const reel = Number(data.reel); const row = Number(data.row);
        const effect = this.#eventEffect(event);
        if (effect && Number.isFinite(reel) && Number.isFinite(row)) this.#pendingCellEffects.push({ effect, reel, row });
        break;
      }
      case "reel-transform": {
        const reel = Number(data.reel);
        if (Array.isArray(data.expandingReels) && typeof data.specialSymbol === "string") {
          this.#chip("special-symbol", "Expanding symbol", titleCase(data.specialSymbol));
          this.#announce("EXPANDING SYMBOL", `${data.expandingReels.length} reels`, "", 900);
        }
        if (Number.isFinite(reel)) {
          const play = () => { this.#playEffect(this.#eventEffect(event), this.#reelBox(reel), { durationMs: 800 }); this.#playSound("reel-transform", 0.65); };
          if (this.#spinState) setTimeout(play, 0); else play();
        }
        break;
      }
      case "colossal-transform": {
        const reel = Number(data.reel); const row = Number(data.row); const size = Number(data.width) || 2;
        const origin = this.#cellBox(reel, row); const end = this.#cellBox(Math.min(reel + size - 1, this.#gridShape().length - 1), row + size - 1);
        this.#playEffect(this.#eventEffect(event), { x: origin.x, y: origin.y, width: end.x + end.width - origin.x, height: end.y + end.height - origin.y }, { durationMs: 900 });
        this.#playSound("colossal-transform", 0.75);
        break;
      }
      case "win": {
        const cells = (data.cells ?? []) as Array<{ reel: number; row: number }>; const celebrate = mayCelebrate(result.betUnits, result.totalWinUnits, this.#game!);
        if (data.regular === true || data.expanding === true) this.#showPayline(cells);
        this.#winningCells = new Set(cells.map((cell) => `${cell.reel}:${cell.row}`)); this.#winUntil = performance.now() + (this.#reducedMotion ? 0 : 850);
        if (celebrate) { for (const cell of cells) this.#playEffect(this.#eventEffect(event), this.#cellBox(cell.reel, cell.row), { durationMs: 750, intensity: .9 }); this.#playSound("win", 0.75); }
        if (typeof data.payoutUnits === "string") {
          this.#roundWinUnits += BigInt(data.payoutUnits);
          this.shadowRoot!.querySelector<HTMLOutputElement>("output")!.value = formatMinorUnits(this.#roundWinUnits.toString());
        }
        await this.#pause(inFreeSpins ? 220 : 360);
        break;
      }
      case "win-multiplier": {
        const multiplier = Number(data.multiplier) || 2;
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 900 });
        this.#floatPrize(`×${multiplier}`, "#ffe08a");
        this.#chip(`multiplier:${featureId ?? "round"}`, featureId ? titleCase(featureId) : "Multiplier", `×${multiplier}`);
        this.#playSound("win-multiplier", 0.75);
        await this.#pause(320);
        break;
      }
      case "symbols-remove": {
        const cells = (data.cells ?? []) as Array<{ reel: number; row: number }>;
        for (const cell of cells) this.#playEffect(this.#eventEffect(event), this.#cellBox(cell.reel, cell.row), { durationMs: 420 });
        this.#playSound("symbols-remove", 0.6);
        await this.#animateRemoval(cells);
        break;
      }
      case "cascade-start": {
        this.#chip("cascade", "Cascade", String(Number(data.cascadeIndex) || 1));
        break;
      }
      case "symbols-drop": {
        if (grid && Number(data.cascadeIndex) > 0) {
          this.#playSound("symbols-drop", 0.55);
          this.#orbValues = [];
          await this.#animateDrop(grid);
          if (Array.isArray(data.orbValues)) this.#orbValues = data.orbValues as Array<Array<number | undefined>>;
        }
        break;
      }
      case "symbol-value": {
        const reel = Number(data.reel); const row = Number(data.row); const value = Number(data.valueMultiplier) || 0;
        if (Number.isFinite(reel) && Number.isFinite(row)) {
          (this.#orbValues[reel] ??= [])[row] = value > 0 ? value : undefined;
          this.#playEffect(this.#eventEffect(event), this.#cellBox(reel, row), { durationMs: 900, intensity: .95 });
        }
        this.#playSound("orb-land", 0.7);
        await this.#pause(140);
        break;
      }
      case "tumble-multiplier": {
        const sum = Number(data.sum) || 0;
        const totalMultiplier = Number(data.totalMultiplier) || sum;
        const after = String(data.winAfterUnits ?? "0");
        this.#setCharacterPose("cast");
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1500, intensity: 1 });
        this.#playSound("tumble-multiplier", 0.9);
        this.#floatPrize(`×${sum}`, "#9db8ff");
        if (data.phase === "free-spin") this.#chip("orb-total", "Total multiplier", `×${totalMultiplier}`);
        this.#roundWinUnits = BigInt(after);
        this.shadowRoot!.querySelector<HTMLOutputElement>("output")!.value = formatMinorUnits(after);
        await this.#pause(650);
        break;
      }
      case "max-win": {
        const capUnits = String(data.capUnits ?? "0");
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 2000, intensity: 1 });
        this.#playSound("big-win", 1);
        await this.#announce("MAX WIN", `Round capped at ${formatMinorUnits(capUnits)}`, "jackpot", 1900);
        break;
      }
      case "free-spins-start": {
        this.#setState("FEATURE");
        this.#playMusic("bonus");
        if (!this.#setMappedCharacterPose({ type: "feature-start", featureId: "free-spins" }, 8200)) this.#setCharacterPose("cast", 8200);
        const spins = Number(data.spins) || 0;
        this.#chip("free-spins", "Free spins", String(spins));
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1400 });
        this.#playSound("free-spins-start", 0.85);
        await this.#announce(`${spins} FREE SPINS`, "All wins from the feature are added to your total");
        break;
      }
      case "free-spin": {
        this.#chip("free-spins", "Free spins", String(Number(data.remaining) || 0));
        const multiplier = Number(data.multiplier) || 1;
        if (multiplier > 1) this.#chip("free-spin-multiplier", "Multiplier", `×${multiplier}`);
        break;
      }
      case "free-spins-end": {
        const total = String(data.totalWinUnits ?? "0");
        this.#playMusic("base");
        this.#playSound("free-spins-end", 0.85);
        if (BigInt(total) > 0n) { this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1600 }); await this.#announce("FEATURE COMPLETE", `Feature win ${formatMinorUnits(total)}`); }
        else await this.#announce("FEATURE COMPLETE", "");
        break;
      }
      case "grid-resize": {
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 900 });
        this.#playSound("grid-resize", 0.7);
        await this.#announce("GRID EXPANDED", featureId ? titleCase(featureId) : "", "", 900);
        break;
      }
      case "respin": {
        const locked = Number(data.locked) || 0;
        if (data.locked !== undefined) this.#chip("locked", "Locked", String(locked));
        if (data.lives !== undefined) this.#chip("lives", "Respins", String(Number(data.lives)));
        if (grid) {
          const transition = heldCellTransition(this.#heldCells, data.cells, grid);
          this.#playSound("respin", 0.7);
          if (!this.#spinState) this.#startReelSpin(transition.spinning);
          await this.#settleReels(grid, true, transition.spinning);
          this.#heldCells = transition.settled;
          this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 700 });
        } else {
          this.#playSound("respin", 0.5);
          await this.#pause(260);
        }
        break;
      }
      case "nudge": {
        this.#playSound("nudge", 0.75);
        const reel = Number(data.reel);
        if (Number.isFinite(reel)) this.#playEffect(this.#eventEffect(event), this.#reelBox(reel), { durationMs: 650 });
        if (grid) await this.#animateDrop(grid);
        break;
      }
      case "hold-win-start": {
        this.#setState("FEATURE");
        this.#playMusic("bonus");
        const startedFeature = typeof data.featureId === "string" ? data.featureId : "hold-and-win";
        if (!this.#setMappedCharacterPose({ type: "feature-start", featureId: startedFeature })) this.#setCharacterPose("cast");
        this.#chip("locked", "Locked", String(Number(data.locked) || 0));
        const initialGrid = data.grid as string[][] | undefined;
        const initialCells = initialGrid ? parseHeldCells(data.cells, initialGrid) : undefined;
        if (initialGrid && initialCells) {
          this.#displayGrid = initialGrid.map((column) => [...column]);
          this.#heldCells = initialCells;
          this.#updateAccessibleGrid();
        } else {
          this.#heldCells = undefined;
        }
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1200 });
        this.#playSound("hold-win-start", 0.85);
        await this.#announce("HOLD & WIN", "Lock coins to grow the prize");
        break;
      }
      case "hold-win-end": {
        const award = String(data.awardUnits ?? "0");
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1500 });
        this.#playSound("hold-win-end", 0.9);
        await this.#announce(`${Number(data.coins) || 0} COINS`, `Awarded ${formatMinorUnits(award)}`);
        this.#heldCells = undefined;
        this.#playMusic("base");
        break;
      }
      case "collection-update": {
        const meterName = typeof data.meter === "string" ? data.meter : typeof data.symbolId === "string" ? data.symbolId : featureId ?? "collection";
        const total = data.total ?? data.remaining ?? 0;
        const target = data.target ? `/${data.target}` : "";
        this.#chip(`meter:${meterName}`, titleCase(meterName), `${total}${target}`);
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 600, intensity: .6 });
        this.#playSound("collection-update", 0.45);
        break;
      }
      case "prize-award": {
        const award = String(data.awardUnits ?? "0");
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1000 });
        this.#floatPrize(`+${formatMinorUnits(award)}`);
        this.#playSound("prize-award", 0.8);
        await this.#pause(420);
        break;
      }
      case "jackpot-contribution": {
        if (featureId && data.poolUnits) this.#chip(`pool:${featureId}`, titleCase(featureId.replace("-jackpot", "")) + " pool", formatMinorUnits(String(data.poolUnits)));
        break;
      }
      case "jackpot-award": {
        const tier = typeof data.tier === "string" ? data.tier.toUpperCase() : "JACKPOT";
        const award = String(data.awardUnits ?? "0");
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1900, intensity: 1 });
        this.#playSound("jackpot-award", 1);
        await this.#announce(`${tier} JACKPOT`, `Awarded ${formatMinorUnits(award)}`, "jackpot", 1900);
        break;
      }
      case "near-miss": {
        const required = Number(data.required) || 3;
        const reel = Math.min(this.#gridShape().length - 1, required);
        this.#playEffect(this.#eventEffect(event), this.#reelBox(reel), { durationMs: 1100 });
        this.#playSound("near-miss", 0.7);
        await this.#announce("SO CLOSE", `${data.scatterCount ?? "?"} of ${required} scatters`, "loss", 950);
        break;
      }
      case "feature-start": {
        if (featureId) {
          this.#setMappedCharacterPose({ type: "feature-start", featureId });
          this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 900 });
          this.#playSound("feature-start", 0.7);
          await this.#announce(titleCase(featureId), this.#featureDetail(featureId, data), "", 1000);
        }
        break;
      }
      case "choice-required": {
        this.#setState("FEATURE");
        this.#playMusic("bonus");
        const action = data.action && typeof data.action === "object" ? data.action as { featureId?: unknown } : undefined;
        const startedFeature = typeof action?.featureId === "string" ? action.featureId : "pick-and-click-bonus";
        if (!this.#setMappedCharacterPose({ type: "feature-start", featureId: startedFeature })) this.#setCharacterPose("cast");
        this.#playSound("choice-required", 0.8);
        break;
      }
      case "choice-resolved": {
        const award = String(data.awardUnits ?? "0");
        const negative = award.startsWith("-");
        this.#playEffect(this.#eventEffect(event), undefined, { durationMs: 1100 });
        this.#playSound(negative ? "gamble-lost" : "choice-resolved", 0.85);
        if (negative) await this.#announce("GAMBLE LOST", "Better luck next time", "loss");
        else if (BigInt(award) > 0n) { this.#floatPrize(`+${formatMinorUnits(award)}`); await this.#announce("BONUS WIN", `Awarded ${formatMinorUnits(award)}`); }
        else await this.#announce("COLLECTED", "Winnings banked", "", 850);
        this.#playMusic("base");
        break;
      }
      case "round-complete":
        break;
      default:
        break;
    }
    this.#legacyThemeSound(event, result);
  }

  #featureDetail(featureId: string, data: Record<string, unknown>): string {
    if (data.addedSpins !== undefined) return `+${data.addedSpins} free spins`;
    if (data.level !== undefined) return `Level ${data.level}`;
    if (data.position !== undefined) return `Advanced to tile ${data.position}`;
    if (data.modifier !== undefined) return titleCase(String(data.modifier));
    if (data.multiplier !== undefined) return `×${data.multiplier}`;
    if (data.outcome === "won") return "Gamble won";
    if (data.outcome === "lost") return "Gamble lost";
    if (data.costUnits !== undefined) return `Cost ${formatMinorUnits(String(data.costUnits))}`;
    if (data.locked !== undefined) return `${data.locked} locked`;
    if (featureId === "chain-reactions") return "Adjacent symbols join the reaction";
    return "";
  }

  /** Backwards-compatible: themes may still map raw event types directly to sound assets. */
  #legacyThemeSound(event: GameEvent, result: GameRoundResult): void {
    if (event.type === "win" && !mayCelebrate(result.betUnits, result.totalWinUnits, this.#game!)) return;
    const assetId = this.#game?.theme.sounds?.[event.type]; const asset = assetId ? this.#asset(assetId) : undefined;
    if (asset) this.#sounds.play(asset.id, 0.8);
  }

  #showWin(units: string): void {
    const message = this.shadowRoot?.querySelector<HTMLElement>(".win-message"); if (!message) return;
    const bet = BigInt(this.#betUnits);
    const win = BigInt(units);
    const animationSize = characterWinSize(this.#betUnits, units);
    if (animationSize) this.#setMappedCharacterPose({ type: "win-size", size: animationSize });
    const tier = win >= bet * 250n ? "EPIC WIN" : win >= bet * 100n ? "MEGA WIN" : win >= bet * 25n ? "BIG WIN" : win >= bet * 10n ? "NICE WIN" : undefined;
    if (tier) {
      this.#playSound("big-win", 1);
      message.textContent = `${tier} ${formatMinorUnits(units)}`;
    } else {
      message.textContent = `WIN ${formatMinorUnits(units)}`;
    }
    if (this.#winMessageTimer) clearTimeout(this.#winMessageTimer);
    message.classList.add("active"); this.#setState("WIN"); this.#winMessageTimer = setTimeout(() => { message.classList.remove("active"); this.#winMessageTimer = undefined; if (!this.#spinState && !this.#collectPending) this.#setState("READY"); }, this.#reducedMotion ? 0 : tier ? 2200 : 1400);
  }
  #hideWin(): void { if (this.#winMessageTimer) clearTimeout(this.#winMessageTimer); this.#winMessageTimer = undefined; this.shadowRoot?.querySelector(".win-message")?.classList.remove("active"); }

  #choiceLabel(choice: { id: string; labelKey: string }, index: number, type: PendingAction["type"]): string {
    const known = this.#catalog.format(choice.labelKey);
    if (known !== choice.labelKey) return known;
    if (choice.id === "collect") return "Collect";
    if (choice.id === "double") return "Double";
    if (choice.id === "red") return "Red";
    if (choice.id === "black") return "Black";
    if (choice.id === "spin") return "Spin the wheel";
    if (type === "path") return `Path ${index + 1}`;
    if (type === "board") return `Move ${index + 1}`;
    if (type === "skill") return `Target ${index + 1}`;
    return `Pick ${index + 1}`;
  }

  #bonusTitle(action: PendingAction): { title: string; hint: string } {
    const title = titleCase(action.featureId);
    switch (action.type) {
      case "wheel": return { title, hint: "Spin the wheel to reveal your prize" };
      case "gamble": return { title, hint: "Risk your win or bank it now" };
      case "path": return { title, hint: "Choose your path" };
      case "board": return { title, hint: "Make your move" };
      case "skill": return { title, hint: "Pick your target" };
      default: return { title, hint: "Make your pick to reveal the prize" };
    }
  }

  #openBonus(result: GameRoundResult): void {
    const overlay = this.shadowRoot!.querySelector<HTMLElement>(".bonus")!;
    const action = result.pendingAction!;
    const { title, hint } = this.#bonusTitle(action);
    const panel = document.createElement("div");
    panel.className = "bonus-panel";
    panel.innerHTML = `<h3>${title}</h3><p>${hint}</p>`;
    const classicGamble = this.classicPresentation && action.type === "gamble";
    overlay.classList.toggle("gamble-screen", classicGamble);
    const start = this.shadowRoot!.querySelector<HTMLButtonElement>(".spin")!;
    const startLabel = start.querySelector<HTMLElement>(".spin-label")!;
    const autoplay = this.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="autoplay"]')!;
    const message = this.shadowRoot!.querySelector<HTMLElement>(".cab-message");
    const requestKeys = new Map<string, string>();
    let submitted = false;
    const resolveChoice = async (choiceId: string, before?: () => Promise<void>) => {
      if (submitted) return;
      submitted = true; this.#choiceBusy = true; start.disabled = true;
      panel.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      this.#playSound("choice-click", 0.6);
      try {
        if (before) await before();
        if (!requestKeys.has(choiceId)) requestKeys.set(choiceId, crypto.randomUUID());
        const resolved = await this.#transport.action({ roundId: result.roundId, playerId: this.#playerId, actionId: action.id, choiceId, idempotencyKey: requestKeys.get(choiceId)! });
        overlay.classList.remove("active");
        overlay.replaceChildren();
        this.#collectPending = undefined; this.#choiceBusy = false;
        this.removeAttribute("gamble-active"); startLabel.textContent = "Start"; start.disabled = false; autoplay.disabled = false;
        if (message) message.textContent = "Please place your bet";
        await this.playResult(resolved);
      } catch (error) { submitted = false; this.#choiceBusy = false; start.disabled = false; panel.querySelectorAll("button").forEach(button => { button.disabled = false; }); this.#reportError(error, "action"); }
    };
    if (action.type === "wheel") {
      const wrap = document.createElement("div");
      wrap.className = "wheel-wrap";
      const wheel = document.createElement("div");
      wheel.className = "wheel";
      wrap.append(wheel);
      panel.append(wrap);
      const row = document.createElement("div");
      row.className = "bonus-grid";
      for (const [index, choice] of action.choices.entries()) {
        const button = document.createElement("button");
        button.className = "bonus-choice";
        button.dataset.style = "gold";
        button.textContent = this.#choiceLabel(choice, index, action.type);
        button.addEventListener("click", () => void resolveChoice(choice.id, () => {
          if (this.#reducedMotion) return Promise.resolve();
          wheel.style.transform = `rotate(${1440 + Math.floor(Math.random() * 360)}deg)`;
          this.#playSound("wheel-spin", 0.8);
          return new Promise((resolve) => setTimeout(resolve, 2150));
        }));
        row.append(button);
      }
      panel.append(row);
    } else if (action.type === "gamble") {
      if (classicGamble) {
        this.#autoplay = false; autoplay.textContent = "Autoplay"; autoplay.disabled = true;
        this.setAttribute("gamble-active", "");
        const amount = formatMinorUnits(result.totalWinUnits);
        panel.innerHTML = `<div class="gamble-amount"><strong>GAMBLE AMOUNT</strong><output>${amount}</output></div><div class="gamble-history"><strong>PREVIOUS CARDS</strong><div>${'<i class="card-back" aria-hidden="true"></i>'.repeat(6)}</div></div><div class="gamble-card card-back" aria-label="Face-down gamble card"></div><p class="gamble-hint">Choose Red or Black to gamble, or take the win!</p>`;
        if (message) message.textContent = `${amount} won`;
      }
      const row = document.createElement("div");
      row.className = "gamble-row";
      for (const [index, choice] of action.choices.entries()) {
        if (classicGamble && choice.id === "collect") { this.#collectPending = () => void resolveChoice(choice.id); startLabel.textContent = "Collect"; start.disabled = false; continue; }
        const button = document.createElement("button");
        button.className = "bonus-choice";
        button.dataset.style = choice.id === "red" ? "red" : choice.id === "black" ? "black" : choice.id === "double" ? "red" : "gold";
        button.textContent = this.#choiceLabel(choice, index, action.type);
        button.addEventListener("click", () => void resolveChoice(choice.id));
        row.append(button);
      }
      panel.append(row);
    } else {
      const grid = document.createElement("div");
      grid.className = "bonus-grid";
      for (const [index, choice] of action.choices.entries()) {
        const card = document.createElement("button");
        card.className = "bonus-card";
        card.innerHTML = `?<small>${this.#choiceLabel(choice, index, action.type)}</small>`;
        card.addEventListener("click", () => {
          card.classList.add("picked");
          card.textContent = "★";
          void resolveChoice(choice.id, () => this.#pause(this.#reducedMotion ? 0 : 620));
        });
        grid.append(card);
      }
      panel.append(grid);
    }
    overlay.replaceChildren(panel);
    overlay.classList.add("active");
  }

  #reportError(value: unknown, operation: SlotErrorEventDetail["operation"]): void {
    const error = value instanceof Error ? value : new Error(String(value)); const banner = this.shadowRoot?.querySelector<HTMLElement>(".error");
    if (banner) { banner.hidden = false; banner.textContent = `Unable to ${operation === "spin" ? "complete the spin" : operation === "action" ? "resolve the choice" : "play this result"}: ${error.message}`; }
    this.dispatchEvent(new CustomEvent<SlotErrorEventDetail>("slot-error", { detail: { error, operation }, bubbles: true, composed: true }));
  }
}

export function defineSlotGame(tagName = "slot-game"): void { if (!customElements.get(tagName)) customElements.define(tagName, SlotGameElement); }
