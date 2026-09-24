import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-rays",
    displayName: "Light Rays",
    description: "Volumetric god-rays that rotate slowly around a glowing core at the center of the target.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const reach = Math.hypot(width, height) * 0.62;
    const rayCount = 12;
    // Full rotation per cycle keeps per-ray randomness seamless when looping.
    const rotation = progress * Math.PI * 2;
    const rays = Array.from({ length: rayCount }, (_, index) => ({
      angle: (index / rayCount) * Math.PI * 2 + random() * 0.25,
      halfWidth: 0.045 + random() * 0.05,
      length: reach * (0.75 + random() * 0.25),
      phase: random() * Math.PI * 2,
      tone: index % 2,
    }));
    ctx.globalCompositeOperation = "lighter";
    for (const ray of rays) {
      const shimmer = 0.6 + 0.4 * Math.sin(progress * Math.PI * 4 + ray.phase);
      const alpha = 0.3 * shimmer * options.intensity;
      const angle = ray.angle + rotation;
      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, ray.length);
      gradient.addColorStop(0, paint.alpha(alpha, 2));
      gradient.addColorStop(0.35, paint.alpha(alpha * 0.7, ray.tone));
      gradient.addColorStop(1, paint.alpha(0, ray.tone));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.cos(angle - ray.halfWidth) * ray.length, centerY + Math.sin(angle - ray.halfWidth) * ray.length);
      ctx.lineTo(centerX + Math.cos(angle + ray.halfWidth) * ray.length, centerY + Math.sin(angle + ray.halfWidth) * ray.length);
      ctx.closePath();
      ctx.fill();
    }
    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, reach * 0.28);
    core.addColorStop(0, paint.alpha(0.8 * options.intensity, 2));
    core.addColorStop(0.5, paint.alpha(0.3 * options.intensity, 0));
    core.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = core;
    ctx.fillRect(x, y, width, height);
  },
});
