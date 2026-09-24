import { defineEffect } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-gem",
    displayName: "Shine Gem",
    description: "Faceted gemstone shimmer with triangular internal faces that catch and release the light.",
    category: "shines",
    targets: ["symbol", "reel", "button", "overlay"],
  },
  palette: ["#ffffff", "#ffe9a8", "#bfe3ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const radius = Math.min(width, height) * 0.46;
    const facetCount = 8;
    const rim = Array.from({ length: facetCount }, (_, index) => {
      const angle = (index / facetCount) * Math.PI * 2 + random() * 0.5;
      const reach = radius * (0.7 + random() * 0.3);
      return { px: centerX + Math.cos(angle) * reach, py: centerY + Math.sin(angle) * reach };
    });
    const facets = Array.from({ length: facetCount }, (_, index) => ({
      a: rim[index]!,
      b: rim[(index + 1) % facetCount]!,
      phase: random() * Math.PI * 2,
      rate: 1 + Math.floor(random() * 2),
      tone: Math.floor(random() * 3),
    }));
    ctx.globalCompositeOperation = "lighter";
    for (const facet of facets) {
      const shimmer = 0.5 + 0.5 * Math.sin(progress * Math.PI * 2 * facet.rate + facet.phase);
      const alpha = (0.08 + shimmer * 0.3) * options.intensity;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(facet.a.px, facet.a.py);
      ctx.lineTo(facet.b.px, facet.b.py);
      ctx.closePath();
      ctx.fillStyle = paint.alpha(alpha, facet.tone);
      ctx.fill();
      const flash = Math.pow(shimmer, 6);
      if (flash > 0.05) {
        ctx.fillStyle = paint.alpha(flash * 0.55 * options.intensity, 0);
        ctx.fill();
      }
    }
    const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 0.5);
    core.addColorStop(0, paint.alpha(0.5 * options.intensity, 0));
    core.addColorStop(0.6, paint.alpha(0.16 * options.intensity, 2));
    core.addColorStop(1, paint.alpha(0, 2));
    ctx.fillStyle = core;
    ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
  },
});
