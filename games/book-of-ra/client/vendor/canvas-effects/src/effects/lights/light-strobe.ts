import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-strobe",
    displayName: "Light Strobe",
    description: "A rapid series of full-target strobe flashes that decay in strength and end cleanly.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const flashes = 4;
    const phase = Math.min(progress, 0.999) * flashes;
    const index = Math.floor(phase);
    const local = phase - index;
    const flash = Math.pow(Math.max(0, 1 - local * 2.4), 1.6);
    const strength = flash * (1 - index * 0.18) * options.intensity;
    if (strength <= 0.01) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = paint.alpha(0.55 * strength, 2);
    ctx.fillRect(x, y, width, height);
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const radius = Math.hypot(width, height) / 2;
    const tint = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    tint.addColorStop(0, paint.alpha(0.5 * strength, 0));
    tint.addColorStop(0.6, paint.alpha(0.25 * strength, 1));
    tint.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, width, height);
  },
});
