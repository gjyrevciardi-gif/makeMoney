/**
 * The Classic board the cabinet paints is the native `reelsSymbols` object.
 *
 * That object is stored on the round as `privateState.result.serverResponse`.
 * `CasinoRound` has no `state` column. Reading `round.state` always misses the
 * board, including when a caller also attaches a decoy `state` field.
 *
 * The pre-drawn `plan` is not returned. A replay must compare the presentation
 * that was settled, not a fresh draw, and the plan must not be copied into logs.
 */

export function persistedClassicReels(round) {
  const serverResponse = round?.privateState?.result?.serverResponse;
  if (!serverResponse || typeof serverResponse !== 'object') return null;
  return serverResponse.reelsSymbols ?? serverResponse.reels ?? null;
}

export function classicReelsMatch(serverResponse, round) {
  const shown = serverResponse?.reelsSymbols ?? serverResponse?.reels ?? null;
  const persisted = persistedClassicReels(round);
  if (!shown || !persisted) return false;
  return JSON.stringify(shown) === JSON.stringify(persisted);
}
