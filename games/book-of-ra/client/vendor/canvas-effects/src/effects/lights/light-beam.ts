import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-beam",
    displayName: "Light Beam",
    description: "A downward beam of light that fades in, sways gently, and fades back out.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const envelope = Math.sin(Math.PI * progress) * options.intensity;
    if (envelope <= 0.01) return;
    const topX = x + width / 2;
    const sway = Math.sin(progress * Math.PI * 2) * width * 0.06;
    const spread = width * 0.4;
    ctx.globalCompositeOperation = "lighter";
    const beam = ctx.createLinearGradient(0, y, 0, y + height);
    beam.addColorStop(0, paint.alpha(0.7 * envelope, 2));
    beam.addColorStop(0.45, paint.alpha(0.32 * envelope, 0));
    beam.addColorStop(1, paint.alpha(0.04 * envelope, 1));
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(topX - width * 0.09, y);
    ctx.lineTo(topX + width * 0.09, y);
    ctx.lineTo(topX + spread + sway, y + height);
    ctx.lineTo(topX - spread + sway, y + height);
    ctx.closePath();
    ctx.fill();
    const sourceRadius = width * 0.24;
    const source = ctx.createRadialGradient(topX, y, 0, topX, y, sourceRadius);
    source.addColorStop(0, paint.alpha(0.85 * envelope, 2));
    source.addColorStop(0.5, paint.alpha(0.35 * envelope, 1));
    source.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = source;
    ctx.fillRect(topX - sourceRadius, y - sourceRadius, sourceRadius * 2, sourceRadius * 2);
  },
});
