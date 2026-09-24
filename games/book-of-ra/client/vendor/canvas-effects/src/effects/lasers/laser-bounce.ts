import { defineEffect, easeOutCubic } from "../../effect.js";

const tri = (u: number): number => {
  const f = u - Math.floor(u);
  return 1 - Math.abs(2 * f - 1);
};

export default defineEffect({
  metadata: {
    id: "laser-bounce",
    displayName: "Laser Bounce",
    description: "A laser bolt that ricochets off the target edges, dragging a fading light trail behind it.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const pad = 4 * dpr;
    const at = (t: number): [number, number] => [
      x + pad + (width - pad * 2) * tri(t * 2.3 + 0.15),
      y + pad + (height - pad * 2) * tri(t * 3.1),
    ];
    const a = Math.min(1, progress * 8, (1 - progress) * 6) * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const samples = 9;
    const span = 0.08;
    const passes = [
      [8 * dpr, paint.alpha(0.16 * a, 1)],
      [3 * dpr, paint.alpha(0.38 * a, 0)],
      [1.4 * dpr, paint.alpha(0.9 * a, 2)],
    ] as const;
    for (const [lineWidth, style] of passes) {
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = style;
      ctx.beginPath();
      for (let k = 0; k <= samples; k++) {
        const t = Math.max(0, progress - span + (span * k) / samples);
        const [px, py] = at(t);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    const [headX, headY] = at(progress);
    const halo = ctx.createRadialGradient(headX, headY, 0, headX, headY, 10 * dpr * (0.6 + 0.4 * easeOutCubic(a)));
    halo.addColorStop(0, paint.alpha(0.9 * a, 2));
    halo.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(x, y, width, height);
  },
});
