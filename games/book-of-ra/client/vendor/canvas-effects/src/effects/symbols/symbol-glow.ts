import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-glow",
    displayName: "Symbol Glow",
    description: "A soft golden aura that breathes around the symbol with a warm inner halo.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.max(width, height) * 0.7;
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2 - Math.PI / 2);
    const level = (0.55 + 0.45 * breath) * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * (0.85 + breath * 0.15));
    halo.addColorStop(0, paint.alpha(0.42 * level, 1));
    halo.addColorStop(0.45, paint.alpha(0.26 * level, 0));
    halo.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = halo;
    ctx.fillRect(x - maxR * 0.3, y - maxR * 0.3, width + maxR * 0.6, height + maxR * 0.6);
    const radius = Math.min(width, height) * 0.14;
    ctx.strokeStyle = paint.alpha(0.35 * level, 0);
    ctx.lineWidth = (2 + breath * 2) * dpr;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.roundRect(x + 3 * dpr, y + 3 * dpr, width - 6 * dpr, height - 6 * dpr, radius);
    ctx.stroke();
  },
});
