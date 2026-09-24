import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "symbol-outline",
    displayName: "Symbol Outline",
    description: "A glowing rounded outline with a bright comet highlight that travels around the cell perimeter.",
    category: "symbols",
    targets: ["symbol"],
  },
  palette: ["#ffd34f", "#fff3c2", "#7ef2ff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const inset = 3 * dpr;
    const rx = x + inset;
    const ry = y + inset;
    const rw = width - inset * 2;
    const rh = height - inset * 2;
    const radius = Math.min(rw, rh) * 0.14;
    const perimeter = 2 * (rw + rh);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = paint.alpha(0.28 * options.intensity, 0);
    ctx.lineWidth = 5 * dpr;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, radius);
    ctx.stroke();
    ctx.strokeStyle = paint.alpha(0.55 * options.intensity, 0);
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    const cometLength = perimeter * 0.18;
    const segments = 14;
    ctx.setLineDash([perimeter / segments / 3, perimeter]);
    for (let i = 0; i < segments; i += 1) {
      const along = (i / segments) * cometLength;
      const tail = i / segments;
      ctx.lineDashOffset = -(progress * perimeter - along);
      ctx.strokeStyle = paint.alpha(0.85 * (1 - tail) * options.intensity, 1);
      ctx.lineWidth = (3.4 - tail * 2.2) * dpr;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, radius);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  },
});
