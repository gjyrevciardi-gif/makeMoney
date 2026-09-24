import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "laser-grid",
    displayName: "Laser Grid",
    description: "A neon grid of horizontal and vertical laser lines that pulse with staggered phases.",
    category: "lasers",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#41f2ff", "#8a5cff", "#e6fdff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const cols = 4;
    const rows = 3;
    const wave = progress * Math.PI * 2;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const drawLine = (x0: number, y0: number, x1: number, y1: number, a: number): void => {
      const passes = [
        [7 * dpr, paint.alpha(0.14 * a, 1)],
        [1.2 * dpr, paint.alpha(0.85 * a, 0)],
      ] as const;
      for (const [lineWidth, style] of passes) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = style;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    };
    for (let i = 0; i <= cols + 1; i++) {
      const phase = random() * Math.PI * 2;
      const a = (0.35 + 0.35 * Math.sin(wave + phase)) * options.intensity;
      const lx = x + (width * i) / (cols + 1);
      drawLine(lx, y, lx, y + height, a);
    }
    for (let j = 0; j <= rows + 1; j++) {
      const phase = random() * Math.PI * 2;
      const a = (0.35 + 0.35 * Math.sin(wave + phase)) * options.intensity;
      const ly = y + (height * j) / (rows + 1);
      drawLine(x, ly, x + width, ly, a);
    }
    const glow = (0.3 + 0.2 * Math.sin(wave)) * options.intensity;
    ctx.fillStyle = paint.alpha(glow, 2);
    for (let i = 1; i <= cols; i++) {
      for (let j = 1; j <= rows; j++) {
        ctx.beginPath();
        ctx.arc(x + (width * i) / (cols + 1), y + (height * j) / (rows + 1), 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});
