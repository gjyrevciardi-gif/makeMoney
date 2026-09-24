import type { GameRoundResult } from "@slot-skills/runtime";

export interface SpinRequest {
  gameId: string;
  playerId: string;
  betUnits: string;
  idempotencyKey: string;
  purchasedFeatureId?: string;
  anteBet?: boolean;
  autoplay?: boolean;
}

export interface ActionRequest {
  roundId: string;
  playerId: string;
  actionId: string;
  choiceId: string;
  idempotencyKey: string;
}

export interface SlotTransport {
  spin(request: SpinRequest): Promise<GameRoundResult>;
  action(request: ActionRequest): Promise<GameRoundResult>;
  round(roundId: string): Promise<GameRoundResult>;
  currentState?(playerId: string, gameId: string): Promise<{ pendingRound?: GameRoundResult; featureState?: Record<string, unknown> }>;
}

export class HttpSlotTransport implements SlotTransport {
  constructor(readonly baseUrl = "", readonly mutatingHeaders: Readonly<Record<string, string>> = {}) {}

  async #request(path: string, init?: RequestInit): Promise<GameRoundResult> {
    const response = await fetch(`${this.baseUrl}${path}`, init);
    const payload = await response.json() as GameRoundResult | { message?: string };
    if (!response.ok) throw new Error("message" in payload ? payload.message ?? `Request failed with ${response.status}` : `Request failed with ${response.status}`);
    return payload as GameRoundResult;
  }

  spin(request: SpinRequest): Promise<GameRoundResult> {
    return this.#request("/v1/spins", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey, ...this.mutatingHeaders }, body: JSON.stringify(request) });
  }

  action(request: ActionRequest): Promise<GameRoundResult> {
    return this.#request(`/v1/rounds/${encodeURIComponent(request.roundId)}/actions`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey, ...this.mutatingHeaders }, body: JSON.stringify(request) });
  }

  round(roundId: string): Promise<GameRoundResult> {
    return this.#request(`/v1/rounds/${encodeURIComponent(roundId)}`);
  }

  async currentState(playerId: string, gameId: string): Promise<{ pendingRound?: GameRoundResult; featureState?: Record<string, unknown> }> {
    const response = await fetch(`/v1/state/${encodeURIComponent(playerId)}?gameId=${encodeURIComponent(gameId)}`);
    if (!response.ok) throw new Error(`State request failed with ${response.status}`);
    return await response.json() as { pendingRound?: GameRoundResult; featureState?: Record<string, unknown> };
  }
}
