import { clamp01, defineEffect, easeOutCubic } from "../../effect.js";
import { fireCount, fireParameters, fireSettings, type FireSettings } from "./fire-primitives.js";

interface FlameTongue {
  x: number;
  tipX: number;
  baseY: number;
  tipY: number;
  width: number;
}

interface FireSimulation {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  image: ImageData;
  current: Float32Array;
  next: Float32Array;
  width: number;
  height: number;
  step: number;
}

const fireSimulations = new WeakMap<CanvasRenderingContext2D, FireSimulation>();

export default defineEffect({
  metadata: {
    id: "fire-inferno",
    displayName: "Fire Inferno",
    description: "Layered natural flames with white-hot cores, turbulent tips, smoke, heat bloom, and windblown embers.",
    category: "fire",
    targets: ["symbol", "reel", "button", "background", "overlay"],
  },
  parameters: fireParameters,
  palette: ["#ff7a18", "#d9280b", "#fff4b0", "#ffb000"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const baseY = y + height * 1.015;
    const phase = progress * Math.PI * 4;
    const fadeIn = easeOutCubic(clamp01(progress / 0.1));
    const fadeOut = easeOutCubic(clamp01((1 - progress) / 0.14));
    const strength = Math.min(fadeIn, fadeOut) * options.intensity;
    if (strength <= 0.005) return;
    const settings = fireSettings(options);

    const flameCount = fireCount(19, settings);
    const flames = Array.from({ length: flameCount }, (_, index) => ({
      xf: clamp01((index + 0.5) / flameCount + (random() - 0.5) * 0.045),
      phase: random() * Math.PI * 2,
      speed: 0.75 + random() * 1.65,
      reach: 0.3 + random() * 0.43 + (index % 6 === 1 ? 0.2 : 0),
      width: 0.58 + random() * 0.68,
      lean: (random() - 0.5) * 0.11,
    }));
    const smoke = Array.from({ length: fireCount(12, settings) }, () => ({
      xf: 0.04 + random() * 0.92,
      phase: random(),
      sway: random() * Math.PI * 2,
      size: 0.65 + random() * 0.85,
      opacity: 0.55 + random() * 0.45,
    }));
    const embers = Array.from({ length: fireCount(42, settings) }, () => ({
      xf: random(),
      phase: random(),
      sway: random() * Math.PI * 2,
      speed: 0.55 + random() * 0.75,
      size: 0.65 + random() * 1.9,
      tone: random(),
    }));

    // Smoke sits behind the fire, giving the bright tongues something physical to emerge through.
    ctx.globalCompositeOperation = "source-over";
    for (const puff of smoke) {
      const cycle = (progress * 0.72 + puff.phase) % 1;
      const life = Math.sin(Math.PI * cycle);
      const radius = Math.max(8, Math.min(width, height) * (0.075 + cycle * 0.07) * puff.size);
      const px = x + puff.xf * width + Math.sin(puff.sway + cycle * Math.PI * 3 * settings.turbulence) * width * 0.045 + settings.wind * width * cycle * 0.16;
      const py = baseY - height * (0.34 + cycle * 0.58);
      const alpha = life * 0.12 * puff.opacity * strength * settings.smoke;
      if (alpha <= 0.005) continue;
      const cloud = ctx.createRadialGradient(px, py, 0, px, py, radius);
      cloud.addColorStop(0, `rgba(38,31,38,${alpha})`);
      cloud.addColorStop(0.58, `rgba(26,22,31,${alpha * 0.55})`);
      cloud.addColorStop(1, "rgba(18,16,24,0)");
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // A low, broad heat source joins the individual tongues into one convincing bed of fire.
    ctx.globalCompositeOperation = "lighter";
    const heat = ctx.createLinearGradient(x, baseY, x, y + height * 0.2);
    heat.addColorStop(0, paint.alpha(0.48 * strength * settings.bloom, 2));
    heat.addColorStop(0.12, paint.alpha(0.34 * strength * settings.bloom, 3));
    heat.addColorStop(0.48, paint.alpha(0.1 * strength * settings.bloom, 0));
    heat.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = heat;
    ctx.fillRect(x, y, width, height);

    const simulated = drawSimulatedFire(ctx, x, y, width, height, progress, strength, settings);
    const contourStrength = strength * (simulated ? 0.1 : 1);

    for (const flame of flames) {
      const wave = flame.phase + phase * flame.speed * settings.turbulence;
      const turbulence = 0.84 + Math.sin(wave) * 0.1 + Math.sin(wave * 2.37 + 1.4) * 0.06 * settings.turbulence;
      const reach = height * flame.reach * turbulence * settings.flameHeight;
      const centerX = x + flame.xf * width + Math.sin(wave * 0.73) * width * 0.012;
      const tipX = centerX + flame.lean * width + Math.sin(wave * 1.31) * width * 0.025 + settings.wind * reach * 0.16;
      const outer: FlameTongue = {
        x: centerX,
        tipX,
        baseY,
        tipY: baseY - reach,
        width: Math.max(7 * dpr, (width / flameCount) * flame.width),
      };

      // Diffuse orange bloom behind the crisp silhouette.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowBlur = Math.max(10, outer.width * 0.8) * settings.bloom;
      ctx.shadowColor = paint.alpha(0.52 * contourStrength * settings.bloom, 0);
      ctx.fillStyle = paint.alpha(0.14 * contourStrength * settings.bloom, 1);
      flamePath(ctx, outer);
      ctx.fill();
      ctx.restore();

      // Translucent red/orange envelope with a narrow, irregular tip.
      ctx.globalCompositeOperation = "screen";
      const outerGradient = ctx.createLinearGradient(0, outer.tipY, 0, baseY);
      outerGradient.addColorStop(0, paint.alpha(0, 1));
      outerGradient.addColorStop(0.12, paint.alpha(0.4 * contourStrength, 1));
      outerGradient.addColorStop(0.46, paint.alpha(0.64 * contourStrength, 0));
      outerGradient.addColorStop(0.82, paint.alpha(0.74 * contourStrength, 3));
      outerGradient.addColorStop(1, paint.alpha(0.48 * contourStrength, 1));
      ctx.fillStyle = outerGradient;
      ctx.filter = `blur(${Math.max(0.45, dpr * 0.7)}px)`;
      flamePath(ctx, outer);
      ctx.fill();
      ctx.filter = "none";

      // Hot yellow-white core; deliberately shorter and thinner than the outer flame.
      const innerReach = reach * (0.35 + 0.07 * Math.sin(wave + 0.8));
      const inner: FlameTongue = {
        x: centerX + Math.sin(wave * 1.7) * outer.width * 0.08,
        tipX: centerX + (tipX - centerX) * 0.38,
        baseY,
        tipY: baseY - innerReach,
        width: outer.width * 0.38,
      };
      ctx.globalCompositeOperation = "lighter";
      const innerGradient = ctx.createLinearGradient(0, inner.tipY, 0, baseY);
      innerGradient.addColorStop(0, paint.alpha(0, 3));
      innerGradient.addColorStop(0.22, paint.alpha(0.48 * contourStrength, 3));
      innerGradient.addColorStop(0.62, paint.alpha(0.76 * contourStrength, 2));
      innerGradient.addColorStop(0.9, paint.alpha(0.84 * contourStrength, 2));
      innerGradient.addColorStop(1, paint.alpha(0.18 * contourStrength, 3));
      ctx.fillStyle = innerGradient;
      flamePath(ctx, inner);
      ctx.fill();
    }

    // Fine, elongated embers sell upward motion better than soft circular particles.
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const ember of embers) {
      const cycle = (progress * ember.speed + ember.phase) % 1;
      const life = Math.sin(Math.PI * cycle);
      const px = x + ember.xf * width + Math.sin(ember.sway + cycle * Math.PI * 5 * settings.turbulence) * width * 0.055 + settings.wind * width * cycle * 0.22;
      const py = baseY - cycle * height * 1.02;
      const alpha = life * (0.32 + ember.tone * 0.62) * strength * settings.embers;
      if (alpha <= 0.015) continue;
      const length = Math.max(2, ember.size * dpr * (2.2 + cycle * 2.8));
      ctx.strokeStyle = paint.alpha(alpha, ember.tone > 0.66 ? 2 : 3);
      ctx.lineWidth = Math.max(0.7, ember.size * dpr * (1 - cycle * 0.55));
      ctx.shadowBlur = 5 * dpr;
      ctx.shadowColor = paint.alpha(alpha * 0.8, 0);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - Math.sin(ember.sway) * length * 0.35, py + length);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  },
  renderReducedMotion({ frame, paint }) {
    const { ctx, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const glow = ctx.createLinearGradient(x, y + height, x, y + height * 0.35);
    glow.addColorStop(0, paint.alpha(0.48 * options.intensity, 2));
    glow.addColorStop(0.35, paint.alpha(0.22 * options.intensity, 0));
    glow.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, width, height);
  },
});

function flamePath(ctx: CanvasRenderingContext2D, flame: FlameTongue): void {
  const half = flame.width / 2;
  const rise = flame.baseY - flame.tipY;
  const bend = flame.tipX - flame.x;
  ctx.beginPath();
  ctx.moveTo(flame.x - half, flame.baseY);
  ctx.bezierCurveTo(
    flame.x - half * 1.12,
    flame.baseY - rise * 0.12,
    flame.x - half * 0.82 + bend * 0.12,
    flame.baseY - rise * 0.38,
    flame.x - half * 0.6 + bend * 0.3,
    flame.baseY - rise * 0.54,
  );
  ctx.bezierCurveTo(
    flame.x - half * 0.34 + bend * 0.58,
    flame.baseY - rise * 0.76,
    flame.tipX - half * 0.12,
    flame.tipY + rise * 0.07,
    flame.tipX,
    flame.tipY,
  );
  ctx.bezierCurveTo(
    flame.tipX + half * 0.16,
    flame.tipY + rise * 0.09,
    flame.x + half * 0.36 + bend * 0.48,
    flame.baseY - rise * 0.72,
    flame.x + half * 0.7 + bend * 0.18,
    flame.baseY - rise * 0.46,
  );
  ctx.bezierCurveTo(
    flame.x + half * 1.05,
    flame.baseY - rise * 0.2,
    flame.x + half * 1.08,
    flame.baseY - rise * 0.08,
    flame.x + half,
    flame.baseY,
  );
  ctx.closePath();
}

function drawSimulatedFire(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  progress: number,
  strength: number,
  settings: FireSettings,
): boolean {
  const columns = Math.max(92, Math.min(180, Math.round(width / 4.5)));
  const rows = Math.max(68, Math.min(132, Math.round(height / 4.5)));
  const simulation = fireSimulation(ctx, columns, rows);
  if (!simulation) return false;

  // Start from an evolved heat field so a new loop never exposes the blocky
  // source row before convection has shaped it into flame.
  const targetStep = 40 + Math.floor(progress * 220);
  if (targetStep < simulation.step) resetSimulation(simulation);
  while (simulation.step < targetStep) advanceSimulation(simulation, settings);

  const pixels = simulation.image.data;
  let offset = 0;
  for (let index = 0; index < simulation.current.length; index += 1) {
    const heat = clamp01(simulation.current[index]!);
    const visibleHeat = clamp01((heat - 0.18) / 0.82);
    const [red, green, blue] = flameColor(heat);
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = Math.round(255 * Math.pow(visibleHeat, 1.32) * Math.min(1, 0.86 * strength * settings.bloom));
    offset += 4;
  }
  simulation.context.putImageData(simulation.image, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.imageSmoothingEnabled = true;
  ctx.filter = "blur(1.3px) saturate(1.16)";
  ctx.drawImage(simulation.canvas, x, y, width, height);
  ctx.restore();
  return true;
}

function fireSimulation(ctx: CanvasRenderingContext2D, width: number, height: number): FireSimulation | undefined {
  const cached = fireSimulations.get(ctx);
  if (cached && cached.width === width && cached.height === height) return cached;

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
  } else return undefined;

  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const simulation: FireSimulation = {
    canvas,
    context,
    image: context.createImageData(width, height),
    current: new Float32Array(width * height),
    next: new Float32Array(width * height),
    width,
    height,
    step: 0,
  };
  fireSimulations.set(ctx, simulation);
  return simulation;
}

function resetSimulation(simulation: FireSimulation): void {
  simulation.current.fill(0);
  simulation.next.fill(0);
  simulation.step = 0;
}

function advanceSimulation(simulation: FireSimulation, settings: FireSettings): void {
  const { width, height, current, next } = simulation;
  next.fill(0);
  const bottom = height - 1;
  for (let x = 0; x < width; x += 1) {
    const sourceWave = Math.sin(x * 0.19 + simulation.step * 0.12 * settings.turbulence)
      + Math.sin(x * 0.071 - simulation.step * 0.075 * settings.turbulence) * 0.58
      + (fireHash(Math.floor(x / 2), bottom, simulation.step) - 0.5) * 0.72 * settings.turbulence;
    const source = sourceWave > 0.08
      ? 0.76 + fireHash(x, bottom, simulation.step) * 0.24
      : 0.16 + fireHash(x, bottom, simulation.step) * 0.3;
    current[bottom * width + x] = source;
    current[(bottom - 1) * width + x] = source * (0.9 + fireHash(x, bottom - 1, simulation.step) * 0.1);
  }

  for (let y = 0; y < height - 2; y += 1) {
    const coolingHeight = 1 - y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const randomWind = fireHash(x + 31, y - 17, simulation.step) > 0.62 ? 1 : fireHash(x - 11, y + 23, simulation.step) < 0.3 ? -1 : 0;
      const wind = randomWind + Math.round(settings.wind * 2);
      const sampleX = (x + wind + width * 2) % width;
      const left = (sampleX - 1 + width) % width;
      const right = (sampleX + 1) % width;
      const below = (y + 1) * width;
      const belowTwo = (y + 2) * width;
      const average = current[below + sampleX]! * 0.55
        + current[below + left]! * 0.125
        + current[below + right]! * 0.125
        + current[belowTwo + sampleX]! * 0.2;
      const cooling = (0.0015 + fireHash(x, y, simulation.step) * 0.008 * settings.turbulence) * (0.35 + coolingHeight * 0.58) / settings.flameHeight;
      next[y * width + x] = Math.max(0, average - cooling);
    }
  }

  for (let y = height - 2; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) next[row + x] = current[row + x]!;
  }
  simulation.current = next;
  simulation.next = current;
  simulation.step += 1;
}

function flameColor(heat: number): readonly [number, number, number] {
  if (heat <= 0.02) return [0, 0, 0];
  if (heat < 0.28) return blend([72, 0, 4], [202, 24, 4], heat / 0.28);
  if (heat < 0.56) return blend([202, 24, 4], [255, 105, 4], (heat - 0.28) / 0.28);
  if (heat < 0.82) return blend([255, 105, 4], [255, 214, 62], (heat - 0.56) / 0.26);
  return blend([255, 214, 62], [255, 250, 208], (heat - 0.82) / 0.18);
}

function blend(from: readonly [number, number, number], to: readonly [number, number, number], amount: number): readonly [number, number, number] {
  const t = clamp01(amount);
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

function fireHash(x: number, y: number, step: number): number {
  let value = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y - step * 3, 0xc2b2ae35) ^ Math.imul(step + 17, 0x27d4eb2d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  return (value >>> 0) / 4294967295;
}
