/**
 * Presentation-only descriptor for the seven approved reference captures.
 * Geometry/state labels mirror games/book-of-ra/reference/manifest.json.
 * These values describe what to display; they never decide a round outcome.
 */
export interface BookReferenceState {
  id: string;
  label: string;
  /** Width used when the reference capture itself implies a cabinet size. */
  nativeWidth: number;
  nativeHeight: number;
  /** Product line count is fixed at ten for this build regardless of the capture. */
  lines: 10;
  overlay: "reels" | "paylines" | "paytable" | "win" | "free-games" | "gamble" | "autoplay";
}

export const bookReferenceStates: readonly BookReferenceState[] = [
  { id: "01-base", label: "Base game", nativeWidth: 1255, nativeHeight: 761, lines: 10, overlay: "reels" },
  { id: "02-paylines", label: "Payline presentation", nativeWidth: 800, nativeHeight: 600, lines: 10, overlay: "paylines" },
  { id: "03-paytable", label: "Paytable/help", nativeWidth: 900, nativeHeight: 506, lines: 10, overlay: "paytable" },
  { id: "04-win", label: "Win presentation", nativeWidth: 1183, nativeHeight: 636, lines: 10, overlay: "win" },
  { id: "05-free-games", label: "Free-games introduction", nativeWidth: 1024, nativeHeight: 570, lines: 10, overlay: "free-games" },
  { id: "06-gamble", label: "Red/Black gamble", nativeWidth: 1716, nativeHeight: 966, lines: 10, overlay: "gamble" },
  { id: "07-autoplay", label: "Deluxe base game/autoplay control", nativeWidth: 1446, nativeHeight: 811, lines: 10, overlay: "autoplay" },
];

/** Reel fill order used by the presentation grid; artwork ids only. */
export const bookSymbolOrder: readonly string[] = [
  "high-1",
  "high-2",
  "high-3",
  "high-4",
  "scatter",
  "low-1",
  "low-2",
  "low-3",
  "low-4",
  "low-5",
];
