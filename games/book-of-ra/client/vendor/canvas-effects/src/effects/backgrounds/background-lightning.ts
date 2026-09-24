import { defineEffect } from "../../effect.js";
import type { EffectParameterDefinition } from "../../types.js";

type Point = readonly [number, number];

const lightningParameters = Object.freeze([
  { key: "strikes", label: "Strike count", description: "Primary strikes in each loop.", kind: "number", defaultValue: 3, min: 1, max: 6, step: 1 },
  { key: "branching", label: "Branching", description: "Density of forks and secondary arcs.", kind: "number", defaultValue: 1, min: 0.25, max: 2, step: 0.05 },
  { key: "chaos", label: "Bolt chaos", description: "Horizontal irregularity of each discharge.", kind: "number", defaultValue: 1, min: 0.2, max: 2, step: 0.05 },
  { key: "flash", label: "Flash energy", description: "Brightness of the scene-wide electrical flash.", kind: "number", defaultValue: 1, min: 0.25, max: 1.75, step: 0.05 },
  { key: "bloom", label: "Electric bloom", description: "Blue atmospheric glow around the white core.", kind: "number", defaultValue: 1, min: 0.25, max: 2, step: 0.05 },
] satisfies readonly EffectParameterDefinition[]);

export default defineEffect({
  metadata: {
    id: "background-lightning",
    displayName: "Background Lightning",
    description: "White-hot forked lightning with deep branching, blue atmospheric bloom, impact glow, and secondary flashes.",
    category: "backgrounds",
    targets: ["background"],
  },
  parameters: lightningParameters,
  palette: ["#75a7ff", "#24104f", "#f8fbff", "#b9d7ff"],
  render({ frame, random, paint }) {
    const { ctx, progress, options, dpr } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const strikes = numberParameter(options.parameters?.strikes, 3);
    const branching = numberParameter(options.parameters?.branching, 1);
    const chaos = numberParameter(options.parameters?.chaos, 1);
    const flashEnergy = numberParameter(options.parameters?.flash, 1);
    const bloom = numberParameter(options.parameters?.bloom, 1);

    const storm = ctx.createLinearGradient(x, y, x, y + height);
    storm.addColorStop(0, paint.alpha(0.13 * options.intensity, 1));
    storm.addColorStop(0.5, paint.alpha(0.055 * options.intensity, 0));
    storm.addColorStop(1, paint.alpha(0.015 * options.intensity, 1));
    ctx.fillStyle = storm;
    ctx.fillRect(x, y, width, height);

    const strikeCount = Math.max(1, Math.round(strikes));
    const schedules = Array.from({ length: strikeCount }, (_, index) => (
      0.035 + index / strikeCount * 0.88 + random() * Math.min(0.045, 0.16 / strikeCount)
    ));
    for (let strike = 0; strike < schedules.length; strike += 1) {
      const life = 0.3;
      const startAt = schedules[strike]!;
      const local = options.loop ? ((progress - startAt) % 1 + 1) % 1 : progress - startAt;
      const boltCount = strike === strikeCount - 1 && strikeCount > 1 ? 2 : 1;
      const bolts = Array.from({ length: boltCount }, (_, boltIndex) => createBolt(
        random,
        x + width * (0.22 + random() * 0.56),
        y - height * 0.025,
        width,
        height * (0.78 + random() * 0.24),
        boltIndex === 0 ? 16 : 11,
        branching,
        chaos,
      ));
      if (local < 0 || local > life) continue;

      const t = local / life;
      const initial = Math.pow(1 - t, 1.55);
      const reflash = Math.exp(-Math.pow((t - 0.38) / 0.085, 2)) * 0.68;
      const needleFlash = Math.exp(-Math.pow((t - 0.68) / 0.055, 2)) * 0.28;
      const energy = Math.min(1.25, initial + reflash + needleFlash) * options.intensity * flashEnergy;
      const flicker = 0.82 + 0.18 * Math.sin(t * 76 + strike * 11);
      const glow = Math.max(0, energy * flicker);

      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = paint.alpha(0.07 * glow, 2);
      ctx.fillRect(x, y, width, height);

      for (const bolt of bolts) {
        const origin = bolt.path[0]!;
        const impact = bolt.path[bolt.path.length - 1]!;
        const cloudGlow = ctx.createRadialGradient(origin[0], origin[1], 0, origin[0], origin[1], width * 0.14);
        cloudGlow.addColorStop(0, paint.alpha(0.14 * glow * bloom, 3));
        cloudGlow.addColorStop(1, paint.alpha(0, 0));
        ctx.fillStyle = cloudGlow;
        ctx.fillRect(x, y, width, height * 0.42);

        const impactGlow = ctx.createRadialGradient(impact[0], impact[1], 0, impact[0], impact[1], Math.min(width, height) * 0.09);
        impactGlow.addColorStop(0, paint.alpha(0.36 * glow * bloom, 2));
        impactGlow.addColorStop(0.28, paint.alpha(0.17 * glow * bloom, 0));
        impactGlow.addColorStop(1, paint.alpha(0, 0));
        ctx.fillStyle = impactGlow;
        ctx.fillRect(impact[0] - width * 0.15, impact[1] - height * 0.15, width * 0.3, height * 0.3);

        const mainWidth = Math.max(1.2 * dpr, Math.min(width, height) * 0.0065);
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = paint.alpha(0.95 * glow, 0);
        ctx.shadowBlur = mainWidth * 3.5 * bloom;
        strokePath(ctx, bolt.path, paint.alpha(0.11 * glow, 0), mainWidth * 4.1);
        ctx.shadowBlur = mainWidth * 1.8;
        strokePath(ctx, bolt.path, paint.alpha(0.62 * glow, 3), mainWidth * 1.8);
        ctx.shadowBlur = mainWidth * 0.8;
        strokePath(ctx, bolt.path, paint.alpha(Math.min(1, 0.98 * glow), 2), mainWidth * 0.62);

        for (const branch of bolt.branches) {
          strokePath(ctx, branch, paint.alpha(0.19 * glow, 0), mainWidth * 2.4);
          strokePath(ctx, branch, paint.alpha(0.82 * glow, 2), mainWidth * 0.46);
        }
        ctx.restore();
      }
    }
  },
  renderReducedMotion({ frame, paint }) {
    const { ctx, options } = frame;
    const { x, y, width, height } = frame.target.bounds();
    const glow = ctx.createRadialGradient(x + width * 0.55, y, 0, x + width * 0.55, y, Math.max(width, height) * 0.65);
    glow.addColorStop(0, paint.alpha(0.2 * options.intensity, 2));
    glow.addColorStop(0.45, paint.alpha(0.08 * options.intensity, 0));
    glow.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, width, height);
  },
});

function createBolt(
  random: () => number,
  startX: number,
  startY: number,
  width: number,
  reach: number,
  segments: number,
  branching: number,
  chaos: number,
): { path: Point[]; branches: Point[][] } {
  const path: Point[] = [[startX, startY]];
  const wind = (random() - 0.5) * width * 0.12;
  let px = startX;
  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const correction = (startX + wind * t - px) * 0.36;
    px += correction + (random() - 0.5) * width * (0.055 - t * 0.025) * chaos;
    px = Math.min(startX + width * 0.24, Math.max(startX - width * 0.24, px));
    path.push([px, startY + reach * t]);
  }

  const branches: Point[][] = [];
  const branchCount = Math.max(1, Math.round((4 + random() * 3) * branching));
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
    const rootIndex = 2 + Math.floor(random() * Math.max(2, segments - 4));
    const root = path[rootIndex]!;
    const direction = random() < 0.5 ? -1 : 1;
    const branch: Point[] = [root];
    let bx = root[0];
    let by = root[1];
    const length = 3 + Math.floor(random() * 4);
    for (let step = 1; step <= length; step += 1) {
      bx += direction * width * (0.016 + random() * 0.035);
      by += reach * (0.018 + random() * 0.038);
      branch.push([bx, by]);
    }
    branches.push(branch);

    if (branch.length >= 5 && random() > 0.38) {
      const subRoot = branch[2 + Math.floor(random() * (branch.length - 3))]!;
      const sub: Point[] = [subRoot];
      let sx = subRoot[0];
      let sy = subRoot[1];
      for (let step = 0; step < 3; step += 1) {
        sx += direction * width * (0.012 + random() * 0.021);
        sy += reach * (0.012 + random() * 0.022);
        sub.push([sx, sy]);
      }
      branches.push(sub);
    }
  }
  return { path, branches };
}

function strokePath(ctx: CanvasRenderingContext2D, points: readonly Point[], style: string, lineWidth: number): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let index = 0; index < points.length; index += 1) {
    const [px, py] = points[index]!;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function numberParameter(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
