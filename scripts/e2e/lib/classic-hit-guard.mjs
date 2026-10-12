/**
 * Deterministic screen<->stage coordinate guard for the Book of Ra Classic
 * native client. Mirrors PIXI 4.5.1 exactly (see pixi.min.js):
 *   InteractionManager.mapPositionToPoint:
 *     i  = isCocoonJS ? resolution : 1 / resolution
 *     px = (x - rect.left) * (canvas.width  / rect.width ) * i
 *     py = (y - rect.top ) * (canvas.height / rect.height) * i
 *   processInteractive hit rule:
 *     hitArea             -> hitArea.contains(local)   (local = worldTransform.applyInverse(global))
 *     typeof containsPoint-> obj.containsPoint(global) (source applies inverse internally)
 *     otherwise           -> local-bounds test [0..width]x[0..height]
 */

export function mapClientToStage(clientX, clientY, opts) {
  const { canvasWidth, canvasHeight, rect } = opts;
  const i = opts.isCocoonJS ? opts.resolution : 1 / opts.resolution;
  return {
    x: (clientX - rect.left) * (canvasWidth / rect.width) * i,
    y: (clientY - rect.top) * (canvasHeight / rect.height) * i,
  };
}

// Analytic inverse of mapClientToStage (no bisection needed: the map is affine).
export function invertStageToClient(stageX, stageY, opts) {
  const { canvasWidth, canvasHeight, rect } = opts;
  const i = opts.isCocoonJS ? opts.resolution : 1 / opts.resolution;
  return {
    x: stageX / ((canvasWidth / rect.width) * i) + rect.left,
    y: stageY / ((canvasHeight / rect.height) * i) + rect.top,
  };
}

// Faithful replica of the PIXI 4.5.1 processInteractive hit decision.
// `applyInverse(globalPoint)` must return the target-local point.
export function targetContainsPoint(target, globalPoint, applyInverse) {
  if (target.hitArea && typeof target.hitArea.contains === 'function') {
    const l = applyInverse(globalPoint);
    return { hit: target.hitArea.contains(l.x, l.y) === true, method: 'hitArea' };
  }
  if (typeof target.containsPoint === 'function') {
    // GLOBAL point: the library applies worldTransform.applyInverse internally.
    return { hit: target.containsPoint(globalPoint) === true, method: 'pixi.containsPoint(global)' };
  }
  const l = applyInverse(globalPoint);
  return {
    hit: l.x >= 0 && l.y >= 0 && l.x <= target.width && l.y <= target.height,
    method: 'localBounds',
  };
}

// Full guard: live local-bounds centre -> global stage point -> client point ->
// round-trip stage probe -> hit decision. Returns null when the mapping is not
// invertible (degenerate rect), so the caller can reject instead of clicking.
export function evaluateSpinGuard({ target, applyInverse, opts }) {
  const toGlobal = target.toGlobal;
  const lb = target.getLocalBounds
    ? target.getLocalBounds()
    : { x: 0, y: 0, width: target.width, height: target.height };
  const localCentre = { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 };
  const gp = toGlobal ? toGlobal(localCentre) : localCentre;
  const client = invertStageToClient(gp.x, gp.y, opts);
  const probe = mapClientToStage(client.x, client.y, opts);
  const roundTripDelta = { x: probe.x - gp.x, y: probe.y - gp.y };
  const { hit, method } = targetContainsPoint(target, gp, applyInverse);
  return { localCentre, globalPoint: gp, client, probe, roundTripDelta, containsPoint: hit, guardMethod: method };
}
