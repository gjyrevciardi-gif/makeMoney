import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-chase",
    displayName: "Laser Chase",
    description: "Glowing laser dashes that chase each other endlessly around the target's perimeter.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const perimeter = 2 * (width + height);
    const at = (u: number): [number, number] => {
      let d = (((u % 1) + 1) % 1) * perimeter;
      if (d < width) return [x + d, y];
      d -= width;
      if (d < height) return [x + width, y + d];
      d -= height;
      if (d < width) return [x + width - d, y + height];
      d -= width;
      return [x, y + height - d];
    };
    const dashes = 3;
    const dashLength = 0.12;
    const samples = 10;
    const a = options.intensity;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < dashes; i++) {
      const head = progress + i / dashes;
      const passes = [
        [8 * dpr, paint.alpha(0.16 * a, 1)],
        [3 * dpr, paint.alpha(0.4 * a, 0)],
        [1.4 * dpr, paint.alpha(0.9 * a, 2)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        for (let k = 0; k <= samples; k++) {
          const [px, py] = at(head - dashLength + (dashLength * k) / samples);
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      const [headX, headY] = at(head);
      ctx.fillStyle = paint.alpha(0.9 * a, 2);
      ctx.beginPath();
      ctx.arc(headX, headY, 2.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  },
});
