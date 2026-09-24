import { clamp01, defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-neon-flicker",
    displayName: "Light Neon Flicker",
    description: "A glowing neon tube border that buzzes and intermittently flickers like a bar sign.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const inset = Math.max(3 * dpr, Math.min(width, height) * 0.05);
    // Harmonics of progress*2*PI keep the buzz periodic so loops are seamless.
    const buzz = 0.78 + 0.22 * Math.sin(progress * Math.PI * 2 * 7 + 1.3) * Math.sin(progress * Math.PI * 2 * 13);
    const dropout = 1 - 0.8 * clamp01((Math.sin(progress * Math.PI * 2 * 2 + 0.7) - 0.9) / 0.1);
    const glow = buzz * dropout * options.intensity;
    if (glow <= 0.02) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    const passes = [
      { lineWidth: 10 * dpr, alpha: 0.1, tone: 1 },
      { lineWidth: 5.5 * dpr, alpha: 0.24, tone: 1 },
      { lineWidth: 2.6 * dpr, alpha: 0.6, tone: 0 },
      { lineWidth: 1.2 * dpr, alpha: 0.95, tone: 2 },
    ];
    for (const pass of passes) {
      ctx.strokeStyle = paint.alpha(pass.alpha * glow, pass.tone);
      ctx.lineWidth = pass.lineWidth;
      ctx.strokeRect(x + inset, y + inset, width - inset * 2, height - inset * 2);
    }
  },
});
