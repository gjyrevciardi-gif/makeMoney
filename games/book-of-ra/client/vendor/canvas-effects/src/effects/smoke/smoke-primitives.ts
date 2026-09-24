import type { EffectPaint } from "../../effect.js";
import type { EffectOptions, EffectParameterDefinition } from "../../types.js";

export const smokeParameters = Object.freeze([
  { key: "density", label: "Density", description: "Number of layered smoke volumes.", kind: "number", defaultValue: 1, min: 0.4, max: 2, step: 0.1 },
  { key: "turbulence", label: "Turbulence", description: "Internal billow and motion irregularity.", kind: "number", defaultValue: 1, min: 0, max: 2, step: 0.1 },
  { key: "wind", label: "Wind", description: "Horizontal drift; negative values blow left.", kind: "number", defaultValue: 0, min: -1, max: 1, step: 0.05 },
  { key: "softness", label: "Softness", description: "Edge diffusion for each smoke volume.", kind: "number", defaultValue: 1, min: 0.25, max: 2, step: 0.05 },
  { key: "volume", label: "Volume", description: "Optical thickness without changing overall intensity.", kind: "number", defaultValue: 1, min: 0.45, max: 1.5, step: 0.05 },
] satisfies readonly EffectParameterDefinition[]);

export interface SmokeSettings {
  density: number;
  turbulence: number;
  wind: number;
  softness: number;
  volume: number;
}

export function smokeSettings(options: EffectOptions): SmokeSettings {
  const parameters = options.parameters ?? {};
  return {
    density: numeric(parameters.density, 1),
    turbulence: numeric(parameters.turbulence, 1),
    wind: numeric(parameters.wind, 0),
    softness: numeric(parameters.softness, 1),
    volume: numeric(parameters.volume, 1),
  };
}

export function smokeCount(base: number, settings: SmokeSettings): number {
  return Math.max(4, Math.round(base * settings.density));
}

/**
 * Draws one soft, internally layered volume. The small offset lobes prevent the
 * repeated flat circles that made the original smoke variants look duplicated.
 */
export function drawSmokeVolume(
  ctx: CanvasRenderingContext2D,
  paint: EffectPaint,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
  tone: number,
  texture: number,
  settings: SmokeSettings,
  dpr: number,
): void {
  if (alpha <= 0.004 || radiusX <= 0 || radiusY <= 0) return;
  const opacity = Math.min(1, alpha * settings.volume);
  const rotation = (texture - 0.5) * 0.5 * settings.turbulence;

  ctx.save();
  try {
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);
    ctx.scale(radiusX, radiusY);
    // Radial falloff supplies the softness; per-particle canvas filters are
    // deliberately avoided because dozens of live blur layers stall mobile GPUs.

    const body = ctx.createRadialGradient(-0.16, -0.18, 0.04, 0, 0, 1);
    body.addColorStop(0, paint.alpha(opacity * 0.92, tone === 1 ? 0 : 2));
    body.addColorStop(0.32, paint.alpha(opacity * 0.76, tone));
    body.addColorStop(0.68, paint.alpha(opacity * 0.34, tone === 2 ? 0 : 1));
    body.addColorStop(0.9, paint.alpha(opacity * 0.08, 1));
    body.addColorStop(1, paint.alpha(0, 1));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();

    const detail = Math.max(0, settings.turbulence);
    for (let lobe = 0; lobe < 2; lobe += 1) {
      const phase = texture * 19.17 + lobe * 2.31;
      const lx = Math.sin(phase) * (0.18 + detail * 0.05);
      const ly = Math.cos(phase * 1.37) * (0.16 + detail * 0.04) - 0.08;
      const size = (0.48 + 0.1 * Math.sin(phase * 0.83 + 1.1)) * settings.softness;
      const lobeGradient = ctx.createRadialGradient(lx - size * 0.18, ly - size * 0.2, 0, lx, ly, size);
      lobeGradient.addColorStop(0, paint.alpha(opacity * (0.13 + detail * 0.055), lobe === 0 ? 2 : tone));
      lobeGradient.addColorStop(0.7, paint.alpha(opacity * 0.035, tone));
      lobeGradient.addColorStop(1, paint.alpha(0, tone));
      ctx.fillStyle = lobeGradient;
      ctx.beginPath();
      ctx.arc(lx, ly, size, 0, Math.PI * 2);
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
