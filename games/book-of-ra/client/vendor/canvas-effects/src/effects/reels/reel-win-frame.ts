import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-win-frame",
    displayName: "Reel Win Frame",
    description: "An animated marching-ants golden frame circling the reel with glowing corner studs and a soft outer halo.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const inset = 3 * dpr;
    const rx = x + inset;
    const ry = y + inset;
    const rw = width - inset * 2;
    const rh = height - inset * 2;
    const dash = 10 * dpr;
    const gap = 7 * dpr;
    const period = dash + gap;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.strokeStyle = paint.alpha(0.25 * options.intensity, 0);
    ctx.lineWidth = 6 * dpr;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([dash, gap]);
    // Offset advances a whole number of dash periods per cycle so looping is seamless.
    ctx.lineDashOffset = -progress * period * 4;
    ctx.strokeStyle = paint.alpha(0.9 * options.intensity, 0);
    ctx.lineWidth = 2.4 * dpr;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.strokeStyle = paint.alpha(0.5 * options.intensity, 2);
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    const shine = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2 * 2);
    const corners = [
      [rx, ry],
      [rx + rw, ry],
      [rx + rw, ry + rh],
      [rx, ry + rh],
    ] as const;
    for (const [cornerX, cornerY] of corners) {
      const stud = ctx.createRadialGradient(cornerX, cornerY, 0, cornerX, cornerY, 7 * dpr);
      stud.addColorStop(0, paint.alpha((0.6 + 0.4 * shine) * options.intensity, 2));
      stud.addColorStop(0.5, paint.alpha(0.4 * options.intensity, 0));
      stud.addColorStop(1, paint.alpha(0));
      ctx.fillStyle = stud;
      ctx.beginPath();
      ctx.arc(cornerX, cornerY, 7 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
