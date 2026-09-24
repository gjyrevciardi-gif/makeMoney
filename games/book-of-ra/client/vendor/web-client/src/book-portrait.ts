/** Portrait presentation dimensions, shared by CSS and source/layout checks. */
export const portraitLayout = Object.freeze({
  breakpoint: 600, padding: 10, gap: 8, controlHeight: 48,
  dialogMargin: 12, dialogPadding: 12, dialogBorder: 3,
  canvasHeightRatio: 0.78,
});

// Stronger than reference-state selectors, but inactive at every desktop viewport.
const p = ':host([presentation="classic"]) .game.immersive';
const { breakpoint, padding, gap, controlHeight, dialogMargin, dialogPadding, dialogBorder, canvasHeightRatio } = portraitLayout;
export const portraitStyles = `
@media(max-width:${breakpoint}px) {
  :host([presentation="classic"]) {min-width:0;max-width:100%;height:auto}
  ${p} {min-width:0;max-width:100%;height:auto;overflow:visible}
  ${p} .stage-row, ${p} .stage {min-width:0;width:100%;max-width:100%}
  ${p} .stage-row:has(.character) {display:block}
  ${p} .character-slot {display:none}
  ${p} canvas.reel-canvas {width:100%;max-width:100%;aspect-ratio:1/${canvasHeightRatio}}
  ${p} .reel-frame {transform:none;max-width:100%}
  ${p} .console.cabinet {display:grid;gap:${gap}px;height:auto;margin:0;padding:${padding}px;border-top:3px solid #d9a631}
  ${p} .cab-message {position:static;inset:auto;width:100%;height:auto;min-height:48px;padding:8px;border-width:2px;font:700 17px/1.3 Arial;overflow-wrap:anywhere}
  ${p} .cab-meters {position:static;inset:auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:100%;height:auto;gap:${gap}px}
  ${p} .cab-meter {padding:0;min-width:0}
  ${p} .cab-meter small, ${p} .cab-meter:nth-child(2) small, ${p} .cab-meter:nth-child(3) small {width:100%;height:auto;min-height:18px;margin:0;font:700 11px/18px Arial;border-width:1px}
  ${p} .cab-meter strong, ${p} .cab-meter:nth-child(2) strong, ${p} .cab-meter:nth-child(3) strong {width:100%;height:auto;min-height:32px;margin:4px 0 0;padding:4px 2px;font:700 14px/22px Arial;border-width:2px;white-space:normal;overflow-wrap:anywhere}
  ${p} .meter-adjust {display:none}
  ${p} .cab-meter.win-total {position:static;inset:auto;grid-column:1/-1;display:flex;width:100%;height:auto;min-height:24px;gap:8px;justify-content:center;opacity:1}
  ${p} .cab-meter.win-total small, ${p} .cab-meter.win-total output {width:auto;height:auto;font:700 14px/22px Arial;white-space:normal;overflow-wrap:anywhere}
  ${p} .cab-message.win-active~.cab-meters .cab-meter.win-total {display:none}
  ${p} .cab-deck {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${gap}px;margin:0}
  ${p} .cab-key, ${p} .spin.cab-start {position:static;inset:auto;top:auto!important;width:100%;min-width:0;height:auto!important;min-height:${controlHeight}px;margin:0;padding:8px;border-width:2px;border-radius:6px;font:700 15px/1.2 Arial;letter-spacing:0;overflow-wrap:anywhere}
  ${p} .spin.cab-start {grid-column:1/-1}
  ${p} .spin-icon {width:24px;height:24px}
  ${p} .spin-label {position:static;width:auto;height:auto;overflow:visible;clip-path:none}
  ${p} .autoplay-status {position:static;inset:auto;width:100%;padding:4px;font:700 14px/1.3 Arial;overflow-wrap:anywhere}
  ${p} .autoplay-status[hidden] {display:none}

  ${p} dialog, ${p} dialog.autoplay-dialog {box-sizing:border-box;inset:0;margin:auto;width:calc(100% - ${dialogMargin * 2}px);max-width:calc(100vw - ${dialogMargin * 2}px);max-height:calc(100dvh - 32px);padding:${dialogPadding}px;border-width:${dialogBorder}px;overflow:auto;overscroll-behavior:contain}
  ${p} dialog h2 {font-size:22px;line-height:1.2;overflow-wrap:anywhere}
  ${p} dialog table {table-layout:fixed;width:100%;font-size:13px}
  ${p} dialog th, ${p} dialog td {padding:6px 3px;overflow-wrap:anywhere}
  ${p} dialog .close, ${p} dialog .autoplay-close {position:sticky;top:0;float:right;min-width:44px;min-height:44px;margin:0 0 8px 8px;padding:4px;font-size:24px;z-index:1}
  ${p} dialog.autoplay-dialog h2 {clear:both}
  ${p} .autoplay-options {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:${gap}px;margin:12px 0}
  ${p} .autoplay-dialog button {min-width:0;min-height:${controlHeight}px;padding:8px;font-size:18px}
  ${p} .autoplay-dialog .autoplay-close {min-width:44px;min-height:44px}
  ${p} [data-auto-start] {width:100%}
  ${p} .announce, ${p} .win-message {max-width:calc(100% - 24px);padding:12px;font-size:18px;overflow-wrap:anywhere}
  ${p} .bonus-panel {width:calc(100% - 16px);max-width:100%;padding:12px;border-width:3px;max-height:100%;overflow:auto}
  ${p} .bonus-panel h3 {font-size:22px}
  ${p} .bonus-panel p {font-size:14px;overflow-wrap:anywhere}

  /* Free Games remains a server-fed overlay, with a wrapping HUD below the reels. */
  ${p} .free-hud {position:relative;z-index:5;display:none;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;width:100%;color:#ffe9a8;background:#190f05;font:700 13px/1.3 Arial;overflow-wrap:anywhere}
  ${p} .free-hud.active {display:flex}
  ${p} .free-hud span {min-width:0;max-width:100%}
  ${p} .free-intro {position:absolute;z-index:5;inset:52px 12px 12px;display:none;align-items:center;justify-content:center;pointer-events:none}
  ${p} .free-intro.active {display:flex}
  ${p} .free-panel {display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;max-height:100%;padding:12px;border:3px ridge #c99a52;border-radius:6px;background:linear-gradient(#e6c68b,#9a6b28);text-align:center;overflow:auto}
  ${p} .free-panel h4 {margin:0;color:#573006;font:700 22px/1.1 Georgia}
  ${p} .free-panel small {font:700 14px/1.2 Arial;color:#422606}
  ${p} .free-symbol {width:64px;height:60px;flex:none;background:#f7ecd2;border:2px solid #8a5a1c;border-radius:4px}
  ${p} .free-hud .free-symbol {width:36px;height:34px}

  /* Reflow the existing Gamble fields; no choices or game state are created here. */
  :host([presentation="classic"][gamble-active]) .game.immersive .stage {min-height:560px}
  ${p} .bonus.gamble-screen {inset:52px 8px 8px;align-items:stretch}
  ${p} .gamble-screen .bonus-panel {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:start;gap:8px;width:100%;height:100%;padding:12px;border-width:3px;border-radius:10px;overflow:auto}
  ${p} .gamble-amount, ${p} .gamble-attempt {position:static;inset:auto;min-width:0;font:700 14px/1.4 Arial;color:#fff;text-shadow:1px 1px #805015;overflow-wrap:anywhere}
  ${p} .gamble-attempt {text-align:right}
  ${p} .gamble-value, ${p} .gamble-attempt span {display:block;color:#fff279}
  ${p} .gamble-history {position:static;inset:auto;grid-column:1/-1;height:auto;display:grid;gap:6px;font:700 12px/1.3 Arial}
  ${p} .gamble-history>strong {width:auto;white-space:normal}
  ${p} .gamble-history>div {display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;height:36px}
  ${p} .card-face {display:flex;align-items:center;justify-content:center;min-width:0;background:#fff5df;color:#151515;font:24px Georgia;border:2px ridge #e8e7dd}
  ${p} .card-face.red {color:#bd121e}
  ${p} .gamble-card {position:static;inset:auto;grid-column:1/-1;justify-self:center;width:64px;height:88px;border-width:3px;font-size:44px}
  ${p} .gamble-result, ${p} .gamble-hint {position:static;inset:auto;grid-column:1/-1;min-width:0;margin:0;font:700 14px/1.3 Arial;overflow-wrap:anywhere}
  ${p} .gamble-screen .gamble-row {position:static;inset:auto;grid-column:1/-1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}
  ${p} .gamble-screen .bonus-choice {width:100%;min-width:0;height:auto;min-height:${controlHeight}px;padding:8px;font-size:18px;border-width:2px;overflow-wrap:anywhere}
}
`;
