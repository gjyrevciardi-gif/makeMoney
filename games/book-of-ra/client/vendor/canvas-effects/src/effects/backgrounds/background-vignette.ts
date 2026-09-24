import { defineEffect, type EffectRenderContext } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "background-vignette",
    displayName: "Background Vignette",
    description: "A gently breathing dark vignette that frames the panel with a faint accent rim.",
    category: "backgrounds",
    targets: ["background"],
  },
  palette: ["#0b0d1f", "#2b1762", "#35d6ed"],
  render(context) {
    const breath = 0.5 + 0.5 * Math.sin(context.frame.progress * Math.PI * 2);
    drawVignette(context, breath);
  },
  renderReducedMotion(context) {
    drawVignette(context, 0.5);
  },
});

function drawVignette({ frame, paint }: EffectRenderContext, breath: number): void {
  const { ctx, options } = frame;
  const { x, y, width, height } = frame.target.bounds();
  const cx = x + width / 2;
  const cy = y + height / 2;
  const outer = Math.hypot(width, height) / 2;
  const inner = outer * (0.45 + 0.06 * breath);
  const strength = (0.42 + 0.08 * breath) * options.intensity;
  const shade = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  shade.addColorStop(0, paint.alpha(0, 0));
  shade.addColorStop(0.6, paint.alpha(strength * 0.45, 0));
  shade.addColorStop(1, paint.alpha(strength, 0));
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, width, height);
  ctx.globalCompositeOperation = "lighter";
  const rim = ctx.createRadialGradient(cx, cy, inner * 0.88, cx, cy, inner * 1.18);
  rim.addColorStop(0, paint.alpha(0, 2));
  rim.addColorStop(0.5, paint.alpha(0.05 * (0.6 + 0.4 * breath) * options.intensity, 2));
  rim.addColorStop(1, paint.alpha(0, 2));
  ctx.fillStyle = rim;
  ctx.fillRect(x, y, width, height);
}
