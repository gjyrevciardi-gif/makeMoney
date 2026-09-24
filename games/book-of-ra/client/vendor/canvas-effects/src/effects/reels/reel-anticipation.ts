import { clamp01, defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-anticipation",
    displayName: "Reel Anticipation",
    description: "Tension-building edge glow that throbs brighter while rising heat shimmer ribbons drift up the reel.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const phase = progress * Math.PI * 2;
    const throb = 0.5 + 0.5 * Math.sin(phase * 3 - Math.PI / 2);
    const build = options.loop ? 0.75 : clamp01(0.35 + progress * 0.65);
    const level = (0.4 + 0.6 * throb) * build * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    const edgeW = width * (0.16 + throb * 0.08);
    const left = ctx.createLinearGradient(x, y, x + edgeW, y);
    left.addColorStop(0, paint.alpha(0.75 * level, 0));
    left.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = left;
    ctx.fillRect(x, y, edgeW, height);
    const right = ctx.createLinearGradient(x + width, y, x + width - edgeW, y);
    right.addColorStop(0, paint.alpha(0.75 * level, 0));
    right.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = right;
    ctx.fillRect(x + width - edgeW, y, edgeW, height);
    ctx.strokeStyle = paint.alpha(0.85 * level, 2);
    ctx.lineWidth = 2 * dpr;
    ctx.strokeRect(x + dpr, y + dpr, width - 2 * dpr, height - 2 * dpr);
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i += 1) {
      const sx = x + width * (0.15 + random() * 0.7);
      const offset = random();
      const speed = 1 + Math.floor(random() * 2);
      const wobblePhase = random() * Math.PI * 2;
      const length = height * (0.16 + random() * 0.14);
      const t = (offset + progress * speed) % 1;
      const sy = y + height - t * (height + length);
      const alpha = 0.3 * Math.sin(Math.PI * t) * build * options.intensity;
      if (alpha <= 0.02) continue;
      ctx.strokeStyle = paint.alpha(alpha, 1);
      ctx.lineWidth = 1.6 * dpr;
      ctx.beginPath();
      const steps = 8;
      for (let s = 0; s <= steps; s += 1) {
        const yy = sy + (s / steps) * length;
        const xx = sx + Math.sin(yy * 0.05 + phase * 2 + wobblePhase) * width * 0.03;
        ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }
  },
});
