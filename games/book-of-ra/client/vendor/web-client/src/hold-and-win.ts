export interface HeldCellTransition {
  spinning?: boolean[][];
  settled?: boolean[][];
}

/** Returns a detached lock mask only when it exactly matches the presented grid. */
export function parseHeldCells(value: unknown, grid: readonly (readonly unknown[])[]): boolean[][] | undefined {
  if (!Array.isArray(value) || value.length !== grid.length) return undefined;
  const parsed: boolean[][] = [];
  for (let reel = 0; reel < grid.length; reel += 1) {
    const column = value[reel];
    if (!Array.isArray(column) || column.length !== grid[reel]!.length || column.some((cell) => typeof cell !== "boolean")) return undefined;
    parsed.push([...column] as boolean[]);
  }
  return parsed;
}

/**
 * Uses the previous mask while symbols are moving, then adopts the event's cumulative mask.
 * A missing legacy mask still becomes usable after the first respin; non-monotonic masks do not
 * hold stale symbols over the moving reels.
 */
export function heldCellTransition(active: unknown, eventCells: unknown, grid: readonly (readonly unknown[])[]): HeldCellTransition {
  const settled = parseHeldCells(eventCells, grid);
  if (!settled) return {};
  const spinning = parseHeldCells(active, grid);
  if (!spinning) return { settled };
  const monotonic = spinning.every((column, reel) => column.every((held, row) => !held || settled[reel]![row]));
  return monotonic ? { spinning, settled } : { settled };
}
