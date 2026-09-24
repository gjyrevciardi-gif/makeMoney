import { defineEffect, type EffectRenderContext } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "background-bokeh",
    displayName: "Background Bokeh",
    description: "Soft out-of-focus light discs that drift lazily and breathe like a shallow depth of field.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#35d6ed", "#2b1762", "#f6ca55"],
  render(context) {
    drawBokeh(context, context.frame.progress * Math.PI * 2, true);
  },
  renderReducedMotion(context) {
    drawBokeh(context, 0, false);
  },
});

function drawBokeh({ frame, random, paint }: EffectRenderContext, phase: number, animate: boolean): void {
  const { ctx, options } = frame;
  const { x, y, width, height } = frame.target.bounds();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 18; i += 1) {
    const baseX = random();
    const baseY = random();
    const orbitX = 0.02 + random() * 0.04;
    const orbitY = 0.015 + random() * 0.03;
    const rateX = 1 + Math.floor(random() * 2);
    const rateY = 1 + Math.floor(random() * 2);
    const off = random() * Math.PI * 2;
    const radius = (0.04 + random() * 0.09) * Math.min(width, height);
    const tone = random();
    const breathe = animate ? 0.85 + 0.15 * Math.sin(phase * 2 + off * 3) : 1;
    const cx = x + (baseX + Math.sin(phase * rateX + off) * orbitX) * width;
    const cy = y + (baseY + Math.cos(phase * rateY + off) * orbitY) * height;
    const alpha = (0.06 + 0.1 * tone) * breathe * options.intensity;
    const toneIndex = tone > 0.72 ? 2 : tone > 0.4 ? 0 : 1;
    const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    disc.addColorStop(0, paint.alpha(alpha * 0.7, toneIndex));
    disc.addColorStop(0.72, paint.alpha(alpha, toneIndex));
    disc.addColorStop(1, paint.alpha(0, toneIndex));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
