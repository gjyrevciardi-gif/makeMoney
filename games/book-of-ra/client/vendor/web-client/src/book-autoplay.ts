/** Client request scheduling only. A spin resolves after authoritative playback. */
export interface AutoplayCompletion { accepted: boolean; canContinue: boolean }
type Phase = "idle" | "running" | "stopping" | "stopped" | "completed" | "error";
interface Options {
  spin: () => Promise<AutoplayCompletion>;
  canStart: () => boolean;
  changed?: () => void;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (handle: unknown) => void;
}
export class BookAutoplay {
  readonly counts = [10, 25, 50, 100] as const;
  #selected = 10;
  #remaining = 0;
  #phase: Phase = "idle";
  #panelOpen = false;
  #inFlight = false;
  #generation = 0;
  #timer: unknown;
  #options: Options;
  constructor(options: Options) { this.#options = options; }
  get state() {
    return { selected: this.#selected, remaining: this.#remaining, phase: this.#phase,
      active: this.#phase === "running", inFlight: this.#inFlight, panelOpen: this.#panelOpen };
  }
  #changed(): void { this.#options.changed?.(); }
  open(): boolean {
    if (this.state.active || this.#inFlight || !this.#options.canStart()) return false;
    this.#panelOpen = true; this.#changed(); return true;
  }
  close(): void { this.#panelOpen = false; this.#changed(); }
  select(count: number): boolean {
    if (!this.#panelOpen || this.state.active || this.#inFlight || !this.counts.some(value => value === count)) return false;
    this.#selected = count; this.#changed(); return true;
  }
  start(): boolean {
    if (!this.#panelOpen || this.state.active || this.#inFlight || !this.#options.canStart()) return false;
    this.#remaining = this.#selected; this.#panelOpen = false; this.#phase = "running";
    const generation = ++this.#generation;
    this.#changed(); void this.#next(generation); return true;
  }
  stop(): void {
    ++this.#generation;
    if (this.#timer !== undefined) {
      (this.#options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.#timer);
      this.#timer = undefined;
    }
    this.#panelOpen = false;
    if (this.state.active || this.#inFlight) this.#phase = this.#inFlight ? "stopping" : "stopped";
    this.#changed();
  }
  dispose(): void { this.stop(); }
  async #next(generation: number): Promise<void> {
    if (generation !== this.#generation || !this.state.active || this.#inFlight) return;
    this.#timer = undefined;
    if (!this.#options.canStart()) { this.stop(); return; }
    this.#inFlight = true; this.#changed();
    let completion: AutoplayCompletion;
    try { completion = await this.#options.spin(); }
    catch { completion = { accepted: false, canContinue: false }; this.#phase = "error"; }
    this.#inFlight = false;
    if (completion.accepted) this.#remaining = Math.max(0, this.#remaining - 1);
    if (generation !== this.#generation) {
      if (this.#phase === "stopping") this.#phase = "stopped";
      this.#changed(); return;
    }
    if (this.#phase === "error") { this.#changed(); return; }
    if (!completion.accepted || !completion.canContinue) this.#phase = "stopped";
    else if (this.#remaining === 0) this.#phase = "completed";
    this.#changed();
    if (!this.state.active || generation !== this.#generation) return;
    this.#timer = (this.#options.schedule ?? setTimeout)(() => { void this.#next(generation); }, 650);
  }
}
export function autoplayStatus(state: BookAutoplay["state"]): string {
  if (state.phase === "idle") return "Select the number of spins";
  if (state.phase === "completed") return "Autoplay complete";
  const label = state.active ? "Autoplay" : state.phase === "stopping" ? "Stopping after this spin"
    : state.phase === "error" ? "Autoplay error" : "Autoplay stopped";
  return `${label} · ${state.remaining} remaining`;
}

/** The reference shows a green AUTO control; the count chooser uses the same palette. */
export const autoplayStyles = `
:host([presentation="classic"]) dialog.autoplay-dialog{display:none;inset:0;margin:auto;width:480px;max-width:calc(100% - 48px);height:auto;padding:26px;border:4px solid #d9ab42;border-radius:14px;background:linear-gradient(#241607,#080603);color:#ffdc72;box-shadow:inset 0 0 0 2px #fff0ae,0 12px 40px #000c;text-align:center}
:host([presentation="classic"]) dialog.autoplay-dialog[open]{display:block}
.autoplay-dialog::backdrop{background:#0009}
:host([presentation="classic"]) dialog.autoplay-dialog h2{margin:0 0 22px;letter-spacing:2px;color:#ffdc72;text-shadow:1px 2px #000}
.autoplay-options{display:flex;gap:10px;justify-content:center;margin:18px 0 24px}
.autoplay-dialog button{font:700 20px Arial;color:#fff8bd;border:2px solid #d7b459;border-radius:8px;background:linear-gradient(#439424,#194509);padding:12px 18px;cursor:pointer}
.autoplay-dialog button[aria-pressed="true"]{color:#1b1402;background:linear-gradient(#ffe68e,#c59b29);box-shadow:0 0 0 2px #fff2a3}
.autoplay-dialog .autoplay-close{position:absolute;right:10px;top:8px;padding:2px 9px;font-size:20px}
.autoplay-status{text-align:center;color:#fff08a;font:bold 16px Arial;padding:6px;background:#100d06}
.autoplay-status[hidden]{display:none}
:host([presentation="classic"]) .autoplay-status{position:absolute;left:56%;top:8.2cqw;width:22%;padding:0;font-size:1cqw;line-height:1.4;background:none}
:host([gamble-active]) .autoplay-status{display:none}
/* Reference 07 places AUTO beside a large circular green spin control. Keep the
   accepted base cabinet unchanged outside this presentation state. */
:host([presentation="classic"][reference-state="07-autoplay"]) .spin.cab-start{left:78.85%;top:1.45cqw;width:8%;height:8cqw;border-radius:50%;font-size:1.05cqw}
:host([presentation="classic"][reference-state="07-autoplay"]) .spin-icon{width:4cqw;height:4cqw}
:host([presentation="classic"][reference-state="07-autoplay"]:not([autoplay-active])) .spin-label{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
:host([presentation="classic"][reference-state="07-autoplay"]) [data-key="autoplay"]{left:73.6%;top:3.25cqw;width:4.1%;height:4.1cqw;border-radius:50%;font-size:.65cqw}
:host([presentation="classic"][reference-state="07-autoplay"]) .autoplay-status{left:63.5%;top:8.3cqw;width:14.3%;font-size:.8cqw}
:host([autoplay-active]) [data-key="gamble"]{visibility:hidden}
:host([autoplay-active]) .spin-icon{display:none}
:host([autoplay-active]) .spin-label{display:inline!important}
`;
