import { defineEffect, easeOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "background-radial-pulse",
    displayName: "Background Radial Pulse",
    description: "A breathing central glow with soft concentric rings that ripple outward in sequence.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const maxR = Math.hypot(width, height) / 2;
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    ctx.globalCompositeOperation = "lighter";
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, maxR * (0.3 + breath * 0.12)));
    core.addColorStop(0, paint.alpha((0.1 + 0.08 * breath) * options.intensity, 0));
    core.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = core;
    ctx.fillRect(x, y, width, height);
    for (let i = 0; i < 3; i += 1) {
      const local = (progress + i / 3) % 1;
      const eased = easeOutCubic(local);
      const r = Math.max(1, maxR * (0.08 + eased * 0.95));
      const alpha = 0.16 * Math.sin(local * Math.PI) * options.intensity;
      if (alpha <= 0.01) continue;
      const inner = Math.max(0, r * 0.78);
      const ring = ctx.createRadialGradient(cx, cy, inner, cx, cy, r * 1.12);
      const toneIndex = i % 3;
      ring.addColorStop(0, paint.alpha(0, toneIndex));
      ring.addColorStop(0.55, paint.alpha(alpha, toneIndex));
      ring.addColorStop(1, paint.alpha(0, toneIndex));
      ctx.fillStyle = ring;
      ctx.fillRect(x, y, width, height);
    }
  },
});
