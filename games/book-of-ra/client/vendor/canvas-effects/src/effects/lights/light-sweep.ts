import { defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-sweep",
    displayName: "Light Sweep",
    description: "A broad vertical band of warm light that sweeps once across the target from left to right.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const bandWidth = width * 0.42;
    const travel = easeInOutCubic(progress);
    const bandX = x - bandWidth + (width + bandWidth * 2) * travel;
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createLinearGradient(bandX - bandWidth * 1.6, 0, bandX + bandWidth * 1.6, 0);
    halo.addColorStop(0, paint.alpha(0, 1));
    halo.addColorStop(0.5, paint.alpha(0.22 * options.intensity, 1));
    halo.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = halo;
    ctx.fillRect(x, y, width, height);
    const band = ctx.createLinearGradient(bandX - bandWidth / 2, 0, bandX + bandWidth / 2, 0);
    band.addColorStop(0, paint.alpha(0, 0));
    band.addColorStop(0.45, paint.alpha(0.5 * options.intensity, 0));
    band.addColorStop(0.5, paint.alpha(0.75 * options.intensity, 2));
    band.addColorStop(0.55, paint.alpha(0.5 * options.intensity, 0));
    band.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = band;
    ctx.fillRect(x, y, width, height);
  },
});
