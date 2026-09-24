import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-backlight",
    displayName: "Light Backlight",
    description: "A large soft glow behind the target that slowly breathes and drifts for an ambient halo.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    ctx.globalCompositeOperation = "lighter";
    const baseRadius = Math.max(width, height) * (0.62 + 0.08 * breath);
    const back = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, baseRadius);
    back.addColorStop(0, paint.alpha((0.4 + 0.2 * breath) * options.intensity, 1));
    back.addColorStop(0.55, paint.alpha(0.2 * options.intensity, 0));
    back.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = back;
    ctx.fillRect(x - baseRadius, y - baseRadius, width + baseRadius * 2, height + baseRadius * 2);
    const driftX = centerX + Math.cos(progress * Math.PI * 2) * width * 0.07;
    const driftY = centerY + Math.sin(progress * Math.PI * 2) * height * 0.07;
    const innerRadius = Math.min(width, height) * 0.5;
    const inner = ctx.createRadialGradient(driftX, driftY, 0, driftX, driftY, innerRadius);
    inner.addColorStop(0, paint.alpha((0.3 + 0.15 * breath) * options.intensity, 2));
    inner.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = inner;
    ctx.fillRect(driftX - innerRadius, driftY - innerRadius, innerRadius * 2, innerRadius * 2);
  },
});
