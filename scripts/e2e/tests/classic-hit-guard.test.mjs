import test from 'node:test';
import assert from 'node:assert/strict';
import { mapClientToStage, invertStageToClient, targetContainsPoint, evaluateSpinGuard } from '../lib/classic-hit-guard.mjs';

// Known live geometry from the classic client: CANVAS_W/H = 1920x1080,
// CanvasRenderer resolution 1, "showAll" CSS size 1600x900 centred in a
// 1440x900 viewport (left -80, top 0).
const opts = { canvasWidth: 1920, canvasHeight: 1080, rect: { left: -80, top: 0, width: 1600, height: 900 }, resolution: 1 };

// Minimal affine world transform (translation only is enough to reproduce the
// source bug and the correct call).
function makeTransform(tx, ty) {
  return { applyInverse: (p) => ({ x: p.x - tx, y: p.y - ty }) };
}

// Faithful PIXI 4.5.1 Sprite: containsPoint(GLOBAL) applies inverse internally.
function makeSprite(tx, ty, width, height) {
  const worldTransform = makeTransform(tx, ty);
  return {
    width, height, worldTransform,
    toGlobal: (l) => ({ x: l.x + tx, y: l.y + ty }),
    getLocalBounds: () => ({ x: 0, y: 0, width, height }),
    containsPoint(global) {
      const l = worldTransform.applyInverse(global);
      return l.x >= 0 && l.y >= 0 && l.x <= width && l.y <= height;
    },
  };
}

test('mapPositionToPoint replica matches PIXI 4.5.1 affine formula', () => {
  assert.deepEqual(mapClientToStage(0, 0, opts), { x: 96, y: 0 });     // (0+80)*1920/1600
  assert.deepEqual(mapClientToStage(720, 450, opts), { x: 960, y: 540 });
});

test('analytic inverse round-trips exactly (no bisection)', () => {
  for (const p of [{ x: 96, y: 0 }, { x: 1754.6, y: 982 }, { x: 960, y: 540 }]) {
    const c = invertStageToClient(p.x, p.y, opts);
    const back = mapClientToStage(c.x, c.y, opts);
    assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
  }
});

test('guard accepts a valid SPIN Sprite hit', () => {
  const sprite = makeSprite(1462, 982, 200, 80); // stage origin from prior run
  const r = evaluateSpinGuard({ target: sprite, applyInverse: (p) => sprite.worldTransform.applyInverse(p), opts });
  assert.equal(r.containsPoint, true);
  assert.equal(r.guardMethod, 'pixi.containsPoint(global)');
  assert.ok(Math.abs(r.roundTripDelta.x) < 1e-6 && Math.abs(r.roundTripDelta.y) < 1e-6);
  // client point maps back inside the sprite's stage box
  assert.ok(r.probe.x > 1462 && r.probe.x < 1662 && r.probe.y > 982 && r.probe.y < 1062);
});

test('guard rejects an invalid target far from the SPIN hit area', () => {
  const sprite = makeSprite(1462, 982, 200, 80);
  const { hit } = targetContainsPoint(sprite, { x: 300, y: 300 }, (p) => sprite.worldTransform.applyInverse(p));
  assert.equal(hit, false);
});

test('regression: pre-applying applyInverse double-transforms and rejects a valid hit', () => {
  const sprite = makeSprite(1462, 982, 200, 80);
  const global = { x: 1562, y: 1022 }; // sprite centre
  const local = sprite.worldTransform.applyInverse(global);
  assert.equal(sprite.containsPoint(global), true);       // correct (source) call
  assert.equal(sprite.containsPoint(local), false);       // old harness call -> rejected
});

test('guard supports a Container target via the local-bounds rule', () => {
  const container = {
    width: 200, height: 80,
    worldTransform: makeTransform(1462, 982),
    toGlobal: (l) => ({ x: l.x + 1462, y: l.y + 982 }),
    getLocalBounds: () => ({ x: 0, y: 0, width: 200, height: 80 }),
  };
  const r = evaluateSpinGuard({ target: container, applyInverse: (p) => container.worldTransform.applyInverse(p), opts });
  assert.equal(r.containsPoint, true);
  assert.equal(r.guardMethod, 'localBounds');
});
