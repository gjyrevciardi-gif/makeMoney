import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "reel-spin-blur",
    displayName: "Reel Spin Blur",
    description: "Soft vertical motion-blur streaks race down the reel with feathered top and bottom fades to sell fast spinning.",
    category: "reels",
    targets: ["reel"],
  },
  palette: ["#ffd34f", "#35d6ed", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 16; i += 1) {
      const sx = x + width * (0.08 + random() * 0.84);
      const length = height * (0.2 + random() * 0.3);
      const offset = random();
      const speed = 2 + Math.floor(random() * 3);
      const tone = random() > 0.75 ? 2 : random() > 0.4 ? 1 : 0;
      const alpha = (0.14 + random() * 0.22) * options.intensity;
      const head = ((offset + progress * speed) % 1) * (height + length) - length;
      const grad = ctx.createLinearGradient(sx, y + head, sx, y + head + length);
      grad.addColorStop(0, paint.alpha(0, tone));
      grad.addColorStop(0.7, paint.alpha(alpha, tone));
      grad.addColorStop(1, paint.alpha(0, tone));
      ctx.strokeStyle = grad;
      ctx.lineWidth = (1.5 + random() * 2.5) * dpr;
      ctx.beginPath();
      ctx.moveTo(sx, Math.max(y, y + head));
      ctx.lineTo(sx, Math.min(y + height, y + head + length));
      ctx.stroke();
    }
    const edgeFade = ctx.createLinearGradient(x, y, x, y + height);
    edgeFade.addColorStop(0, paint.alpha(0.22 * options.intensity, 2));
    edgeFade.addColorStop(0.2, paint.alpha(0));
    edgeFade.addColorStop(0.8, paint.alpha(0));
    edgeFade.addColorStop(1, paint.alpha(0.22 * options.intensity, 2));
    ctx.fillStyle = edgeFade;
    ctx.fillRect(x, y, width, height);
  },
});
