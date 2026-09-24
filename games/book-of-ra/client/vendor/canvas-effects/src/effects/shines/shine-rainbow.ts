import { defineEffect, easeInOutCubic } from "../../effect.js";

export default defineEffect({
  metadata: {
    id: "shine-rainbow",
    displayName: "Shine Rainbow",
    description: "A prismatic band of spectral hues that sweeps across the target like light through a prism.",
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
    const bandWidth = diagonal * 0.34;
    const bandX = -half - bandWidth + (diagonal + bandWidth * 2) * easeInOutCubic(progress);
    const hueShift = progress * 90;
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(centerX, centerY);
    ctx.rotate(-Math.PI / 7);
    const spectrum = ctx.createLinearGradient(bandX - bandWidth, 0, bandX + bandWidth, 0);
    const bands = 7;
    for (let index = 0; index <= bands; index += 1) {
      const stop = index / bands;
      const hue = (hueShift + stop * 300) % 360;
      const window = Math.sin(Math.PI * stop);
      spectrum.addColorStop(stop, `hsla(${hue},100%,62%,${(0.4 * window * options.intensity).toFixed(3)})`);
    }
    ctx.fillStyle = spectrum;
    ctx.fillRect(-half - bandWidth, -half, (half + bandWidth) * 2, diagonal);
    const crest = ctx.createLinearGradient(bandX - bandWidth * 0.18, 0, bandX + bandWidth * 0.18, 0);
    crest.addColorStop(0, paint.alpha(0, 0));
    crest.addColorStop(0.5, paint.alpha(0.5 * options.intensity, 0));
    crest.addColorStop(1, paint.alpha(0, 0));
    ctx.fillStyle = crest;
    ctx.fillRect(-half - bandWidth, -half, (half + bandWidth) * 2, diagonal);
  },
});
