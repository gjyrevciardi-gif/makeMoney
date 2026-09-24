import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "light-spotlight",
    displayName: "Light Spotlight",
    description: "A theatrical spotlight cone that sways side to side, tracking a bright elliptical hotspot.",
    category: "lights",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  palette: ["#fff3c2", "#ffd34f", "#ffffff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const sway = Math.sin(progress * Math.PI * 2);
    const spotX = x + width / 2 + sway * width * 0.28;
    const spotY = y + height * 0.62;
    const spotRadius = Math.max(width, height) * 0.34;
    const apexX = x + width / 2 + sway * width * 0.08;
    const apexY = y - height * 0.25;
    ctx.globalCompositeOperation = "lighter";
    const cone = ctx.createLinearGradient(apexX, apexY, spotX, spotY);
    cone.addColorStop(0, paint.alpha(0.05 * options.intensity, 2));
    cone.addColorStop(0.5, paint.alpha(0.16 * options.intensity, 0));
    cone.addColorStop(1, paint.alpha(0.3 * options.intensity, 1));
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(apexX - width * 0.05, apexY);
    ctx.lineTo(apexX + width * 0.05, apexY);
    ctx.lineTo(spotX + spotRadius * 0.9, spotY);
    ctx.lineTo(spotX - spotRadius * 0.9, spotY);
    ctx.closePath();
    ctx.fill();
    ctx.translate(spotX, spotY);
    ctx.scale(1, 0.62);
    const hotspot = ctx.createRadialGradient(0, 0, 0, 0, 0, spotRadius);
    hotspot.addColorStop(0, paint.alpha(0.85 * options.intensity, 2));
    hotspot.addColorStop(0.4, paint.alpha(0.45 * options.intensity, 0));
    hotspot.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = hotspot;
    ctx.fillRect(-spotRadius, -spotRadius, spotRadius * 2, spotRadius * 2);
  },
});
