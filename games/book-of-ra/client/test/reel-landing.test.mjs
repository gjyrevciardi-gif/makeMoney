import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { sampleReelMotion } from '../vendor/web-client/src/reel-motion.ts';

// Frame-level audit of the real draw/stop pipeline (#settleReels -> #drawFrame ->
// #drawReel -> #drawSymbol). The methods under test are executed verbatim from
// source against a recording 2D context; nothing here is a pixel comparison and
// nothing is a browser run.
const source = readFileSync(new URL('../vendor/web-client/src/slot-game.ts', import.meta.url), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `missing source marker: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `missing source marker: ${to}`);
  return source.slice(start, end);
};

const formatMinorUnits = slice('function formatMinorUnits(value: string): string {', 'function clamp(');
const clamp = slice('function clamp(value: number, minimum = 0, maximum = 1): number {', 'function titleCase(');
const gridShape = slice('  #layoutRowCounts(): number[] {', '  #preloadAssets(');
const reelArea = slice('  #reelArea(', '  #cellBox(');
const drawPath = slice('  #cellBox(', '  #startReelSpin(');
const winPath = slice('  #firstWinCell(', '  #freeSurface(');
const settlePath = slice('  #startReelSpin(', '  #animateRemoval(');
const framePath = slice('  #drawFrame(now: number): void {', '  /** Leftmost paid cell');

const classSource = stripTypeScriptTypes(`
class ReelProbe {
  shadowRoot = { querySelector: () => this.#canvas };
  #canvas = { width: 1255, height: 630, getContext: () => this.context };
  #context = undefined;
  #game = undefined;
  #displayGrid = [];
  #spinState = undefined;
  #dropState = undefined;
  #removalState = undefined;
  #winningCells = new Set();
  #winBadgeUnits = undefined;
  #winUntil = 0;
  #heldCells = undefined;
  #orbValues = [];
  #presentationImages = new Map();
  #images = new Map();
  #configurationPreview = undefined;
  #reducedMotion = false;
  #immersive = false;
  context = undefined;
  states = [];
  ${gridShape}
  ${reelArea}
  ${drawPath}
  ${winPath}
  ${settlePath}
  ${framePath}
  get classicPresentation() { return true; }
  get symbolPresentation() { return {}; }
  hasAttribute() { return false; }
  getAttribute() { return '01-base'; }
  setAttribute() {}
  #asset() { return undefined; }
  #drawBackground() {}
  #drawCabinetFrame() {}
  #drawReferencePaytable() {}
  #syncReferencePaylines() {}
  #drawOrbBadge() {}
  #updateAccessibleGrid() {}
  #playSound() {}
  #hideWin() { this.#winBadgeUnits = undefined; }
  #setState(value) { this.states.push(value); }
  constructor(game) { this.#game = game; this.#displayGrid = game.grid.map((column) => [...column]); }
  start(grid) {
    this.#displayGrid = grid.map((column) => [...column]);
    this.#spinState = undefined;
    this.settled = this.#settleReels(grid.map((column) => [...column]), false, undefined);
  }
  get target() { return this.#spinState?.target; }
  get motions() { return this.#spinState?.motions; }
  get grid() { return this.#displayGrid; }
  get reelsMoving() { return Boolean(this.#spinState); }
  cellBox(reel, row) { return this.#cellBox(reel, row, this.#canvas); }
  frame(now) { this.#drawFrame(now); }
  highlight(cells, units, until) { this.#winningCells = new Set(cells); this.#winBadgeUnits = units; this.#winUntil = until; }
  clearHighlight() { this.#winningCells = new Set(); this.#winBadgeUnits = undefined; }
}
`);

const helpers = `${formatMinorUnits}\n${clamp}`;
const ReelProbe = new Function('sampleReelMotion', 'devicePixelRatio', `${stripTypeScriptTypes(helpers)}\n${classSource}; return ReelProbe;`)(sampleReelMotion, 1);

const ALPHABET = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
const game = {
  symbols: ALPHABET.map((id) => ({ id, name: id, asset: id })),
  presentation: { symbolScale: 1 },
  grid: ALPHABET.slice(0, 5).map((id) => [id, id, id]),
};
const symbolIds = new Set(ALPHABET);

/** Recording 2D context: keeps symbol text with its drawn box centre. */
function recordingContext(canvas) {
  const noop = () => {};
  const record = { texts: [], fills: 0, strokes: 0 };
  const context = new Proxy({}, {
    get(target, property) {
      if (property === 'canvas') return canvas;
      if (property === 'measureText') return () => ({ width: 12 });
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (property === 'fillText') return (text, x, y) => { record.texts.push({ text: String(text), x: Number(x), y: Number(y) }); };
      if (property === 'fillRect') return () => { record.fills += 1; };
      if (property === 'strokeRect') return () => { record.strokes += 1; };
      if (Object.prototype.hasOwnProperty.call(target, property)) return target[property];
      return noop;
    },
    set(target, property, value) { target[property] = value; return true; },
  });
  return { context, record };
}

function drawProbe() {
  const probe = new ReelProbe(game);
  const { context, record } = recordingContext(probe.shadowRoot.querySelector());
  probe.context = context;
  return { probe, record };
}

/**
 * Reads the 5x3 board the frame actually paints: for every cell the covering
 * symbol is the drawn symbol whose box centre sits closest to the cell centre.
 */
function visibleGrid(probe, record) {
  const drawn = record.texts.filter((entry) => symbolIds.has(entry.text));
  return Array.from({ length: 5 }, (_, reel) => Array.from({ length: 3 }, (_, row) => {
    const cell = probe.cellBox(reel, row);
    const centre = { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 };
    let best; let bestDistance = Infinity;
    for (const entry of drawn) {
      if (Math.abs(entry.x - centre.x) > cell.width / 2) continue;
      const distance = Math.abs(entry.y - centre.y);
      if (distance < bestDistance) { bestDistance = distance; best = entry; }
    }
    assert.ok(best, `no symbol painted for reel ${reel} row ${row}`);
    return best.text;
  }));
}

const fillerAt = (reel, index) => ALPHABET[((index + reel * 3) % ALPHABET.length + ALPHABET.length) % ALPHABET.length];

/**
 * Timing decides how far each strip travels, so the target grid is chosen against
 * the filler that would otherwise show at the landing indices. Rows 1 and 2 are the
 * rows a mis-indexed strip shows before the stop; row 0 catches the same defect.
 */
function targetGridFor(probe) {
  return probe.motions.map((motion, reel) => {
    const blocked = new Map([1, 2].map((row) => [row, new Set([fillerAt(reel, motion.targetPosition - row)])]));
    const chosen = [];
    for (let row = 0; row < 3; row += 1) {
      const blockedHere = blocked.get(row) ?? new Set();
      const symbol = ALPHABET.find((id) => !blockedHere.has(id) && !chosen.includes(id));
      assert.ok(symbol, `no uncovered target symbol for reel ${reel} row ${row}`);
      chosen.push(symbol);
    }
    return chosen;
  });
}

test('every reel stops directly on its authoritative target column', () => {
  const measure = drawProbe();
  measure.probe.start(game.grid);
  const target = targetGridFor(measure.probe);

  const spin = drawProbe();
  spin.probe.start(target);
  const motions = spin.probe.motions;
  assert.equal(motions.length, 5);

  try {
    for (let reel = 0; reel < 5; reel += 1) {
      const motion = motions[reel];
      // One millisecond before the reel completes: the last frame that still moves.
      spin.record.texts.length = 0;
      spin.probe.frame(motion.startTime + motion.duration - 1);
      const board = visibleGrid(spin.probe, spin.record);
      assert.deepEqual(board[reel], target[reel], `reel ${reel + 1} did not land on its target column`);
    }
  } finally { void spin.probe.settled; }
});

test('the stopped surface equals the authoritative target grid', async () => {
  const measure = drawProbe();
  measure.probe.start(game.grid);
  const target = targetGridFor(measure.probe);

  const spin = drawProbe();
  spin.probe.start(target);
  const completedAt = Math.max(...spin.probe.motions.map((motion) => motion.startTime + motion.duration));
  spin.record.texts.length = 0;
  spin.probe.frame(completedAt + 16);
  await spin.probe.settled;

  assert.deepEqual(spin.probe.grid, target);
  assert.deepEqual(visibleGrid(spin.probe, spin.record), target);
  assert.equal(spin.probe.reelsMoving, false);
});

test('no base mutation between the last stop and WIN_PRESENTATION', async () => {
  const measure = drawProbe();
  measure.probe.start(game.grid);
  const target = targetGridFor(measure.probe);

  const spin = drawProbe();
  spin.probe.start(target);
  const completedAt = Math.max(...spin.probe.motions.map((motion) => motion.startTime + motion.duration));
  spin.probe.frame(completedAt + 16);
  await spin.probe.settled;

  // WIN_PRESENTATION: the server's paid cells arrive as a highlight over the same board.
  spin.probe.highlight(['0:0', '1:0', '2:0'], '3000', completedAt + 1600);
  for (let now = completedAt + 16; now <= completedAt + 3200; now += 16) {
    spin.record.texts.length = 0;
    spin.probe.frame(now);
    assert.deepEqual(visibleGrid(spin.probe, spin.record), target, `board changed at ${Math.round(now - completedAt)}ms after the last stop`);
  }
});

test('highlighting paints over the existing symbols without replacing them', async () => {
  const measure = drawProbe();
  measure.probe.start(game.grid);
  const target = targetGridFor(measure.probe);

  const spin = drawProbe();
  spin.probe.start(target);
  const completedAt = Math.max(...spin.probe.motions.map((motion) => motion.startTime + motion.duration));
  spin.probe.frame(completedAt + 16);
  await spin.probe.settled;

  const plain = [];
  for (let now = completedAt + 16; now <= completedAt + 480; now += 16) {
    spin.record.texts.length = 0;
    spin.probe.frame(now);
    plain.push(visibleGrid(spin.probe, spin.record));
  }

  spin.probe.highlight(['0:0', '1:1', '3:2'], '3000', completedAt + 960);
  const highlighted = [];
  for (let now = completedAt + 16; now <= completedAt + 480; now += 16) {
    spin.record.texts.length = 0;
    const before = spin.record.fills + spin.record.strokes;
    spin.probe.frame(now);
    highlighted.push(visibleGrid(spin.probe, spin.record));
    assert.ok(spin.record.fills + spin.record.strokes > before, 'highlight decoration was not drawn');
  }

  assert.deepEqual(highlighted, plain);
});
