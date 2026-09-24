import { defineEffect, easeOutCubic, type EffectRenderContext } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "background-stars",
    displayName: "Background Stars",
    description: "A twinkling starfield over a faint nebula haze, crossed by the occasional shooting star.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render(context) {
    drawStars(context, context.frame.progress * Math.PI * 2, true);
  },
  renderReducedMotion(context) {
    drawStars(context, 0, false);
  },
});

function drawStars({ frame, random, paint }: EffectRenderContext, phase: number, animate: boolean): void {
  const { ctx, progress, options, dpr } = frame;
  const { x, y, width, height } = frame.target.bounds();
  const haze = ctx.createRadialGradient(x + width * 0.5, y + height * 0.35, 0, x + width * 0.5, y + height * 0.35, Math.max(width, height) * 0.75);
  haze.addColorStop(0, paint.alpha(0.1 * options.intensity, 1));
  haze.addColorStop(1, paint.alpha(0, 1));
  ctx.fillStyle = haze;
  ctx.fillRect(x, y, width, height);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 80; i += 1) {
    const starX = x + random() * width;
    const starY = y + random() * height;
    const size = (0.4 + random() * 1.3) * dpr;
    const rate = 1 + Math.floor(random() * 3);
    const offset = random() * Math.PI * 2;
    const tone = random();
    const twinkle = animate ? 0.5 + 0.5 * Math.sin(phase * rate + offset) : 0.65;
    const alpha = (0.1 + 0.45 * twinkle) * options.intensity;
    ctx.fillStyle = paint.alpha(alpha, tone > 0.8 ? 2 : 0);
    ctx.beginPath();
    ctx.arc(starX, starY, size * (0.8 + 0.4 * twinkle), 0, Math.PI * 2);
    ctx.fill();
  }
  if (!animate) return;
  for (let s = 0; s < 2; s += 1) {
    const born = random();
    const startX = x + width * (0.15 + random() * 0.7);
    const startY = y + height * (0.05 + random() * 0.3);
    const length = width * (0.12 + random() * 0.1);
    const local = ((progress - born + 1) % 1) / 0.12;
    if (local >= 1) continue;
    const travel = easeOutCubic(local);
    const headX = startX + travel * length;
    const headY = startY + travel * length * 0.35;
    const tailX = headX - length * 0.4;
    const tailY = headY - length * 0.14;
    const trail = ctx.createLinearGradient(tailX, tailY, headX, headY);
    trail.addColorStop(0, paint.alpha(0, 2));
    trail.addColorStop(1, paint.alpha(0.7 * (1 - local) * options.intensity, 2));
    ctx.strokeStyle = trail;
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(headX, headY);
    ctx.stroke();
  }
}
