import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-vignette-pulse",
    displayName: "Light Vignette Pulse",
    description: "A luminous vignette around the edges of the target that breathes brighter and softer.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const radius = Math.hypot(width, height) / 2;
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    const strength = (0.35 + 0.35 * breath) * options.intensity;
    ctx.globalCompositeOperation = "lighter";
    const vignette = ctx.createRadialGradient(centerX, centerY, radius * 0.35, centerX, centerY, radius);
    vignette.addColorStop(0, paint.alpha(0, 0));
    vignette.addColorStop(0.55, paint.alpha(strength * 0.25, 0));
    vignette.addColorStop(0.85, paint.alpha(strength * 0.7, 1));
    vignette.addColorStop(1, paint.alpha(strength, 2));
    ctx.fillStyle = vignette;
    ctx.fillRect(x, y, width, height);
  },
});
