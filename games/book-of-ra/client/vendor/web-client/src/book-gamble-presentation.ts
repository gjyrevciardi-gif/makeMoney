/** Public Book response adapter. No outcome selection or payout arithmetic. */
type Colour = "red" | "black";
type Choice = Colour | "collect";
interface GambleResponse {
  complete: boolean;
  totalWinUnits: string;
  pendingAction?: { type: string; choices: readonly { id: string }[] };
  featureState: { bookOfRa?: unknown };
  events: readonly { type: string; data: Record<string, unknown> }[];
}
export interface BookGambleView {
  amountUnits: string;
  settlementUnits?: string;
  attempt: number;
  maximum: number;
  complete: boolean;
  status: "pending" | "won" | "lost" | "collected";
  colour?: Colour;
  history: Colour[];
  choices: Choice[];
}
const colour = (value: unknown): Colour | undefined => value === "red" || value === "black" ? value : undefined;
const choice = (value: unknown): value is Choice => value === "red" || value === "black" || value === "collect";
const units = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error(`Missing authoritative Gamble ${field}`);
  return value;
};
const counter = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Missing authoritative Gamble ${field}`);
  return value;
};

/** Responses contain cumulative events; only the latest resolved choice is current. */
export function bookGambleResolution(result: GambleResponse) {
  return result.events.findLast((event) => event.type === "choice-resolved" &&
    choice(event.data.choiceId) && typeof event.data.pendingWinUnits === "string");
}

export function bookGambleView(result: GambleResponse, autoplay: boolean, requestAutoplay = false): BookGambleView | undefined {
  if (autoplay || requestAutoplay) return undefined;
  const resolved = bookGambleResolution(result)?.data;
  const pending = result.pendingAction?.type === "gamble";
  if (!pending && !resolved) return undefined;
  const state = (result.featureState.bookOfRa ?? {}) as Record<string, unknown>;
  const offered = result.events.findLast((event) => event.type === "choice-required" && event.data.featureId === "gamble-feature")?.data;
  let status: BookGambleView["status"] = "pending";
  if (resolved) {
    if (resolved.choiceId === "collect") status = "collected";
    else if (resolved.won === true) status = "won";
    else if (resolved.won === false) status = "lost";
    else throw new Error("Missing authoritative Gamble won flag");
  }
  const history = Array.isArray(state.gambleHistory) ? state.gambleHistory.flatMap((entry) => {
    const revealed = entry && typeof entry === "object" ? colour(entry.winningColour) : undefined;
    return revealed ? [revealed] : [];
  }) : [];
  return {
    amountUnits: units(resolved?.pendingWinUnits ?? state.pendingWin, "pendingWinUnits"),
    settlementUnits: resolved ? units(resolved.settlementUnits, "settlementUnits") : undefined,
    attempt: counter(resolved?.attempt ?? state.gambleAttempts, "attempt"),
    maximum: counter(state.gambleMaxAttempts ?? offered?.maxAttempts, "maxAttempts"),
    complete: result.complete,
    status,
    colour: colour(resolved?.winningColour) ?? history.at(-1),
    history,
    // Choice availability and completion are supplied by the server, not a local cap.
    choices: pending && !result.complete ? result.pendingAction!.choices.map((entry) => entry.id).filter(choice) : [],
  };
}

export function bookGambleStatus(view: BookGambleView): string {
  if (view.status === "collected") return "COLLECTED";
  if (view.status === "lost") return "GAMBLE LOST";
  if (view.complete) return "GAMBLE COMPLETE";
  return view.status === "won" ? "GAMBLE WON" : "CHOOSE RED OR BLACK";
}

/** All interpolated values are validated units, counters, colours or fixed copy. */
export function bookGambleMarkup(view: BookGambleView, format: (units: string) => string): string {
  const face = (value: Colour | undefined) => value ? `card-face ${value}` : "card-back";
  const history = view.history.slice(-6);
  const cards = Array.from({ length: 6 }, (_, index) => `<i class="${face(history[index])}" aria-label="${history[index] ?? "Unrevealed"} card">${history[index] === "red" ? "♥" : history[index] === "black" ? "♠" : ""}</i>`).join("");
  return `<div class="gamble-amount"><strong>GAMBLE AMOUNT</strong><span class="gamble-value">${format(view.amountUnits)}</span></div>
    <div class="gamble-attempt"><strong>ATTEMPT</strong><span>${view.attempt} / ${view.maximum}</span></div>
    <div class="gamble-history"><strong>PREVIOUS CARDS</strong><div>${cards}</div></div>
    <div class="gamble-card ${face(view.colour)}" aria-label="${view.colour ?? "Face-down"} gamble card">${view.colour === "red" ? "♥" : view.colour === "black" ? "♠" : ""}</div>
    <p class="gamble-result" role="status">${bookGambleStatus(view)}</p>
    <p class="gamble-hint">${view.complete ? `Settled: ${format(view.settlementUnits!)}` : "Choose Red or Black, or Collect your win."}</p>`;
}
