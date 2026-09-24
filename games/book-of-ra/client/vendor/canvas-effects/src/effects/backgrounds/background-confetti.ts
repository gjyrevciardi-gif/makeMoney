import { clamp01, defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "background-confetti",
    displayName: "Background Confetti",
    description: "Vividly coloured confetti pieces that fall, sway, and tumble across the panel.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#ff5a7a", "#ffd34f", "#35d6ed", "#8affc1", "#c684ff", "#ff9d2e"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const phase = progress * Math.PI * 2;
    const fade = options.loop ? 1 : clamp01((1 - progress) * 5) * clamp01(progress * 12);
    if (fade <= 0.01) return;
    for (let i = 0; i < 60; i += 1) {
      const baseX = random();
      const baseY = random();
      // wrap period is 1.25 panel heights, so fall must be a multiple of 1.25 for a seamless loop
      const fall = 1.25 * (1 + Math.floor(random() * 2));
      const swayAmp = 0.02 + random() * 0.04;
      const swayRate = 2 + Math.floor(random() * 3);
      const spin = (1 + Math.floor(random() * 3)) * (random() < 0.5 ? -1 : 1);
      const tumbleOff = random() * Math.PI * 2;
      const size = (4 + random() * 5) * dpr;
      const colorIndex = Math.floor(random() * 6);
      const py = ((((baseY + progress * fall) % 1.25) + 1.25) % 1.25) - 0.125;
      const px = baseX + Math.sin(phase * swayRate + tumbleOff) * swayAmp;
      const cx = x + px * width;
      const cy = y + py * height;
      const rot = phase * spin + tumbleOff;
      const flip = Math.sin(phase * (swayRate + 2) + tumbleOff * 2);
      const w = size;
      const h = size * 0.6 * Math.abs(flip) + size * 0.15;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      ctx.fillStyle = paint.alpha(0.7 * fade * (0.7 + 0.3 * Math.abs(flip)) * options.intensity, colorIndex);
      ctx.beginPath();
      ctx.moveTo(cx - (w / 2) * cos + (h / 2) * sin, cy - (w / 2) * sin - (h / 2) * cos);
      ctx.lineTo(cx + (w / 2) * cos + (h / 2) * sin, cy + (w / 2) * sin - (h / 2) * cos);
      ctx.lineTo(cx + (w / 2) * cos - (h / 2) * sin, cy + (w / 2) * sin + (h / 2) * cos);
      ctx.lineTo(cx - (w / 2) * cos - (h / 2) * sin, cy - (w / 2) * sin + (h / 2) * cos);
      ctx.closePath();
      ctx.fill();
    }
  },
});
