import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-electrify",
    displayName: "Symbol Electrify",
    description: "Crackling blue-white lightning arcs snap around the cell rim with flickering bright cores and a static haze.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#7ef2ff", "#b9f6ff", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cx = x + width / 2;
    const cy = y + height / 2;
    const phase = progress * Math.PI * 2;
    ctx.globalCompositeOperation = "lighter";
    const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.65);
    haze.addColorStop(0, paint.alpha(0.16 * options.intensity, 0));
    haze.addColorStop(1, paint.alpha(0));
    ctx.fillStyle = haze;
    ctx.fillRect(x, y, width, height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const rimX = width * 0.46;
    const rimY = height * 0.46;
    for (let bolt = 0; bolt < 5; bolt += 1) {
      const startAngle = random() * Math.PI * 2;
      const span = 0.7 + random() * 0.9;
      const flickerFreq = 4 + Math.floor(random() * 5);
      const flickerPhase = random() * Math.PI * 2;
      const jitterFreq = 3 + Math.floor(random() * 4);
      const segments = 7;
      const offsets = Array.from({ length: segments + 1 }, () => (random() - 0.5) * 2);
      const flicker = Math.sin(phase * flickerFreq + flickerPhase);
      const visible = flicker > -0.35;
      const strength = Math.max(0, 0.3 + 0.7 * flicker);
      if (!visible || strength <= 0.02) continue;
      const points: Array<readonly [number, number]> = [];
      for (let s = 0; s <= segments; s += 1) {
        const t = s / segments;
        const angle = startAngle + span * t;
        const wobble = (offsets[s] ?? 0) * (s === 0 || s === segments ? 0.15 : 1);
        const jitter = wobble * Math.sin(phase * jitterFreq + s * 1.7) * Math.min(width, height) * 0.08;
        const rimNorm = 1 + jitter / Math.min(rimX, rimY);
        points.push([cx + Math.cos(angle) * rimX * rimNorm, cy + Math.sin(angle) * rimY * rimNorm]);
      }
      for (const pass of [0, 1] as const) {
        ctx.strokeStyle = pass === 0 ? paint.alpha(0.3 * strength * options.intensity, 0) : paint.alpha(0.9 * strength * options.intensity, 2);
        ctx.lineWidth = (pass === 0 ? 4 : 1.4) * dpr;
        ctx.beginPath();
        for (const [px, py] of points) ctx.lineTo(px, py);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 5; i += 1) {
      const angle = random() * Math.PI * 2;
      const sparkPhase = random() * Math.PI * 2;
      const spark = Math.max(0, Math.sin(phase * 6 + sparkPhase));
      if (spark <= 0.4) continue;
      ctx.fillStyle = paint.alpha(spark * options.intensity, 1);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * rimX, cy + Math.sin(angle) * rimY, 1.6 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
