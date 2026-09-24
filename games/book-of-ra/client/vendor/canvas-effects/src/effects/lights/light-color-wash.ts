import { clamp01, defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-color-wash",
    displayName: "Light Color Wash",
    description: "A soft diagonal wash of palette colors that drifts back and forth across the whole target.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const drift = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    ctx.globalCompositeOperation = "lighter";
    const wash = ctx.createLinearGradient(x, y, x + width, y + height);
    wash.addColorStop(0, paint.alpha(0.24 * options.intensity, 0));
    wash.addColorStop(clamp01(0.2 + drift * 0.6), paint.alpha(0.3 * options.intensity, 1));
    wash.addColorStop(1, paint.alpha(0.22 * options.intensity, 2));
    ctx.fillStyle = wash;
    ctx.fillRect(x, y, width, height);
    const bandX = x + width * (0.5 + 0.4 * Math.cos(progress * Math.PI * 2));
    const bandWidth = width * 0.55;
    const band = ctx.createLinearGradient(bandX - bandWidth, 0, bandX + bandWidth, 0);
    band.addColorStop(0, paint.alpha(0, 1));
    band.addColorStop(0.5, paint.alpha(0.18 * options.intensity, 1));
    band.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = band;
    ctx.fillRect(x, y, width, height);
  },
});
