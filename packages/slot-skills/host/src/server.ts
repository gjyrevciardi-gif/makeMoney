import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import type { ReferenceGameHost } from "./host.js";

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

export type ReferenceHostBroadcast = (payload: unknown) => void;
export type ReferenceHostHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

/** Build the reusable HTTP portion of the reference host. */
export function createReferenceHttpHandler(host: ReferenceGameHost, broadcast: ReferenceHostBroadcast = () => undefined): ReferenceHostHttpHandler {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const owned = url.pathname === "/health" || url.pathname === "/v1/spins" || /^\/v1\/rounds\/[^/]+(?:\/actions)?$/.test(url.pathname) || /^\/v1\/state\/[^/]+$/.test(url.pathname);
    if (!owned) return false;
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        send(response, 200, { ok: true, games: [...host.games.keys()] });
        return true;
      }
      const state = /^\/v1\/state\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && state) {
        send(response, 200, await host.currentState(decodeURIComponent(state[1]!), url.searchParams.get("gameId") ?? "book-of-the-sands"));
        return true;
      }
      if (request.method === "POST" && url.pathname === "/v1/spins") {
        const payload = await body(request);
        const result = await host.spin({
          gameId: String(payload.gameId), playerId: String(payload.playerId), betUnits: String(payload.betUnits),
          idempotencyKey: String(request.headers["idempotency-key"] ?? payload.idempotencyKey ?? ""),
          ...(typeof payload.purchasedFeatureId === "string" ? { purchasedFeatureId: payload.purchasedFeatureId } : {}),
          ...(payload.anteBet === true ? { anteBet: true } : {}),
          ...(payload.autoplay === true ? { autoplay: true } : {}),
        });
        broadcast({ type: "round", result });
        send(response, 200, result);
        return true;
      }
      const action = /^\/v1\/rounds\/([^/]+)\/actions$/.exec(url.pathname);
      if (request.method === "POST" && action) {
        const payload = await body(request);
        const result = await host.resolveAction({ roundId: decodeURIComponent(action[1]!), playerId: String(payload.playerId), actionId: String(payload.actionId), choiceId: String(payload.choiceId), idempotencyKey: String(request.headers["idempotency-key"] ?? payload.idempotencyKey ?? "") });
        broadcast({ type: "round", result });
        send(response, 200, result);
        return true;
      }
      const round = /^\/v1\/rounds\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && round) {
        send(response, 200, await host.round(decodeURIComponent(round[1]!)));
        return true;
      }
      send(response, 404, { error: "not-found" });
      return true;
    } catch (error) {
      send(response, 400, { error: "request-failed", message: error instanceof Error ? error.message : String(error) });
      return true;
    }
  };
}

export function createReferenceServer(host: ReferenceGameHost) {
  let broadcast: ReferenceHostBroadcast = () => undefined;
  const handler = createReferenceHttpHandler(host, (payload) => broadcast(payload));
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) send(response, 404, { error: "not-found" });
  });
  const sockets = new WebSocketServer({ server, path: "/v1/events" });
  broadcast = (payload) => {
    const encoded = JSON.stringify(payload);
    for (const client of sockets.clients) if (client.readyState === client.OPEN) client.send(encoded);
  };
  return { server, sockets, listen: (port: number, hostname = "127.0.0.1") => new Promise<void>((resolve) => server.listen(port, hostname, resolve)), close: () => new Promise<void>((resolve, reject) => sockets.close(() => server.close((error) => error ? reject(error) : resolve()))) };
}
