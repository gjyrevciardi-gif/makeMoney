import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-marquee",
    displayName: "Light Marquee",
    description: "Casino-sign marquee bulbs around the border with a bright chase running along the frame.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const inset = Math.max(4 * dpr, Math.min(width, height) * 0.07);
    const left = x + inset;
    const top = y + inset;
    const innerWidth = width - inset * 2;
    const innerHeight = height - inset * 2;
    const perimeter = 2 * (innerWidth + innerHeight);
    const count = Math.max(12, Math.round(perimeter / Math.max(8 * dpr, Math.min(innerWidth, innerHeight) * 0.22)));
    const stripes = Math.max(3, Math.round(count / 3));
    const bulbRadius = Math.max(1.5 * dpr, Math.min(innerWidth, innerHeight) * 0.05);
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < count; index += 1) {
      const along = (index / count) * perimeter;
      let bulbX: number;
      let bulbY: number;
      if (along < innerWidth) {
        bulbX = left + along;
        bulbY = top;
      } else if (along < innerWidth + innerHeight) {
        bulbX = left + innerWidth;
        bulbY = top + (along - innerWidth);
      } else if (along < innerWidth * 2 + innerHeight) {
        bulbX = left + innerWidth - (along - innerWidth - innerHeight);
        bulbY = top + innerHeight;
      } else {
        bulbX = left;
        bulbY = top + innerHeight - (along - innerWidth * 2 - innerHeight);
      }
      // Integer chase speed and stripe count keep the loop seamless around the frame.
      const chase = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * 2 * ((index / count) * stripes - progress * 2)), 3);
      const alpha = (0.12 + 0.88 * chase) * options.intensity;
      const glowRadius = bulbRadius * (1.6 + chase * 2.2);
      const glow = ctx.createRadialGradient(bulbX, bulbY, 0, bulbX, bulbY, glowRadius);
      glow.addColorStop(0, paint.alpha(alpha, 2));
      glow.addColorStop(0.4, paint.alpha(alpha * 0.7, chase > 0.5 ? 0 : 1));
      glow.addColorStop(1, paint.alpha(0, 1));
      ctx.fillStyle = glow;
      ctx.fillRect(bulbX - glowRadius, bulbY - glowRadius, glowRadius * 2, glowRadius * 2);
    }
  },
});
