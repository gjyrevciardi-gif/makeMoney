/**
 * Book of Ra client bundle entry.
 *
 * Frontend presentation only: re-exports the imported slot web component plus
 * deterministic helpers used by the presentation test harness. No RNG, math,
 * payout, wallet or settlement logic is added here.
 */
export {
  defineSlotGame,
  SlotGameElement,
} from "../vendor/web-client/src/index.ts";
export { HttpSlotTransport, type SlotTransport } from "../vendor/web-client/src/transport.ts";
export { MessageCatalog } from "../vendor/web-client/src/localization.ts";
export { sampleReelMotion, type ReelMotion } from "../vendor/web-client/src/reel-motion.ts";
export {
  bookStyles,
  drawBookCabinet,
  type SymbolImagePresentation,
} from "../vendor/web-client/src/book-presentation.ts";
export { bookSymbolOrder, bookReferenceStates, type BookReferenceState } from "./reference-states.ts";
