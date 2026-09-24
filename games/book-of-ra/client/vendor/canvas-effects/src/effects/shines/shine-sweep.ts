import { defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-sweep",
    displayName: "Shine Sweep",
    description: "A wide glossy sheen that glides once across the target like light over polished glass.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const diagonal = Math.hypot(width, height);
    const half = diagonal / 2;
    const soft = diagonal * 0.3;
    const crisp = diagonal * 0.08;
    const bandX = -half - soft + (diagonal + soft * 2) * easeInOutCubic(progress);
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 9);
    const sheen = ctx.createLinearGradient(bandX - soft, 0, bandX + soft, 0);
    sheen.addColorStop(0, paint.alpha(0, 1));
    sheen.addColorStop(0.5, paint.alpha(0.3 * options.intensity, 1));
    sheen.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = sheen;
    ctx.fillRect(-half - soft, -half - soft, (half + soft) * 2, (half + soft) * 2);
    const highlight = ctx.createLinearGradient(bandX - crisp, 0, bandX + crisp, 0);
    highlight.addColorStop(0, paint.alpha(0, 0));
    highlight.addColorStop(0.5, paint.alpha(0.7 * options.intensity, 0));
    highlight.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = highlight;
    ctx.fillRect(-half - soft, -half - soft, (half + soft) * 2, (half + soft) * 2);
  },
});
