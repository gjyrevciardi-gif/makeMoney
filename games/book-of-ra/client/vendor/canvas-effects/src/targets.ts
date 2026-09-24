import type { EffectTarget, EffectTargetKind } from "./types.js";

export function fixedTarget(
  kind: EffectTargetKind,
  x: number,
  y: number,
  width: number,
  height: number,
  clip = true,
  id?: string,
): EffectTarget {
  return {
    kind,
    clip,
    ...(id === undefined ? {} : { id }),
    bounds: () => ({ x, y, width, height }),
  };
}

export function elementTarget(
  kind: EffectTargetKind,
  element: Element,
  canvas: HTMLCanvasElement,
  clip = true,
  id?: string,
): EffectTarget {
  return {
    kind,
    clip,
    ...(id === undefined ? {} : { id }),
    bounds: () => {
      const elementRect = element.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, canvasRect.width);
      const scaleY = canvas.height / Math.max(1, canvasRect.height);
      return {
        x: (elementRect.left - canvasRect.left) * scaleX,
        y: (elementRect.top - canvasRect.top) * scaleY,
        width: elementRect.width * scaleX,
        height: elementRect.height * scaleY,
      };
    },
  };
}

