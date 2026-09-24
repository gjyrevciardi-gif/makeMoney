import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "background-particles",
    displayName: "Background Particles",
    description: "Soft glowing motes that drift upward and sway gently across the whole panel.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const phase = progress * Math.PI * 2;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 46; i += 1) {
      const baseX = random();
      const baseY = random();
      const rise = 1 + Math.floor(random() * 2);
      const sway = 0.01 + random() * 0.025;
      const swayRate = 1 + Math.floor(random() * 3);
      const swayOffset = random() * Math.PI * 2;
      const size = (1 + random() * 2.4) * dpr;
      const tone = random();
      const py = (((baseY - progress * rise) % 1) + 1) % 1;
      const px = ((baseX + Math.sin(phase * swayRate + swayOffset) * sway) % 1 + 1) % 1;
      const edge = Math.min(1, py * 5, (1 - py) * 5);
      const alpha = 0.28 * (0.35 + 0.65 * tone) * edge * options.intensity;
      if (alpha <= 0.01) continue;
      const mx = x + px * width;
      const my = y + py * height;
      const reach = size * 4;
      const glow = ctx.createRadialGradient(mx, my, 0, mx, my, reach);
      const toneIndex = tone > 0.7 ? 2 : 0;
      glow.addColorStop(0, paint.alpha(alpha, toneIndex));
      glow.addColorStop(1, paint.alpha(0, toneIndex));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mx, my, reach, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
