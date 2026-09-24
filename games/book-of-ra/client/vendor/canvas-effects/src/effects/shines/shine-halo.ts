import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-halo",
    displayName: "Shine Halo",
    description: "A luminous ring hovering around the target that breathes in radius and brightness.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const breath = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2);
    const radius = Math.max(width, height) * (0.42 + 0.05 * breath);
    const band = Math.min(width, height) * 0.16;
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(centerX, centerY, Math.max(0, radius - band), centerX, centerY, radius + band);
    halo.addColorStop(0, paint.alpha(0, 1));
    halo.addColorStop(0.45, paint.alpha((0.35 + 0.25 * breath) * options.intensity, 1));
    halo.addColorStop(0.55, paint.alpha((0.45 + 0.3 * breath) * options.intensity, 0));
    halo.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = halo;
    const extent = radius + band;
    ctx.fillRect(centerX - extent, centerY - extent, extent * 2, extent * 2);
    const echoRadius = radius * 1.3;
    const echoBand = band * 1.5;
    const echo = ctx.createRadialGradient(centerX, centerY, Math.max(0, echoRadius - echoBand), centerX, centerY, echoRadius + echoBand);
    echo.addColorStop(0, paint.alpha(0, 2));
    echo.addColorStop(0.5, paint.alpha((0.3 - 0.18 * breath) * options.intensity, 2));
    echo.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = echo;
    const echoExtent = echoRadius + echoBand;
    ctx.fillRect(centerX - echoExtent, centerY - echoExtent, echoExtent * 2, echoExtent * 2);
  },
});
