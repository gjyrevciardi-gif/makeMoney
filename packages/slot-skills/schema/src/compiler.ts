import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveCompatibility } from "./compatibility.js";
import { validateGameConfig } from "./schema.js";
import { validateCanonicalSymbolContract } from "./symbol-contract.js";
import type { CompiledGame, ComponentManifest, GameConfig, GameLock } from "./types.js";

export interface CompileOptions {
  catalog?: readonly ComponentManifest[];
  release?: boolean;
  outputDir?: string;
  now?: Date;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sorted(entry)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 2)}\n`;
}

export function hashValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function hashMathContract(game: Pick<GameConfig, "math" | "features">): string {
  return hashValue({ math: game.math, features: game.features });
}

async function readStructured(file: string): Promise<unknown> {
  const raw = await readFile(file, "utf8");
  return file.endsWith(".json") ? JSON.parse(raw) : parse(raw);
}

async function resolveSection(baseDir: string, value: unknown): Promise<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.source !== "string") return value;
  const target = path.resolve(baseDir, record.source);
  const loaded = await readStructured(target);
  if (Object.keys(record).length === 1) return loaded;
  const { source: _source, ...overrides } = record;
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new Error(`Cannot merge section source ${target}`);
  return { ...(loaded as Record<string, unknown>), ...overrides };
}

async function resolveSource(sourcePath: string): Promise<unknown> {
  const source = await readStructured(sourcePath);
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("Game source must be an object");
  const baseDir = path.dirname(sourcePath);
  const resolved: Record<string, unknown> = { ...(source as Record<string, unknown>) };
  for (const key of ["math", "theme", "assets", "locales", "jurisdiction", "providers", "presentation"]) {
    if (key in resolved) resolved[key] = await resolveSection(baseDir, resolved[key]);
  }
  return resolved;
}

function validateSemantics(game: GameConfig, options: CompileOptions): void {
  const rows = Array.isArray(game.layout.rows) ? game.layout.rows : Array(game.layout.reels).fill(game.layout.rows) as number[];
  if (rows.length !== game.layout.reels) throw new Error("Variable row configuration must contain one entry per reel");
  const cells = rows.reduce((total, count) => total + count, 0);
  if (cells > (game.layout.maxVisibleCells ?? 100)) throw new Error(`Visible grid has ${cells} cells, above its configured limit`);
  const symbolIds = game.symbols.map((symbol) => symbol.id);
  if (new Set(symbolIds).size !== symbolIds.length) throw new Error("Symbol IDs must be unique");
  validateCanonicalSymbolContract(game.symbols);
  const knownSymbols = new Set(symbolIds);
  for (const entry of game.math.paytable) if (!knownSymbols.has(entry.symbolId)) throw new Error(`Paytable refers to unknown symbol ${entry.symbolId}`);
  for (const strip of game.math.reelStrips ?? []) for (const symbol of strip) if (!knownSymbols.has(symbol)) throw new Error(`Reel strip refers to unknown symbol ${symbol}`);
  for (const symbol of Object.keys(game.math.symbolWeights ?? {})) if (!knownSymbols.has(symbol)) throw new Error(`Weights refer to unknown symbol ${symbol}`);
  for (const feature of game.features) for (const [key, value] of Object.entries(feature.config ?? {})) {
    if (key.endsWith("SymbolId") && typeof value === "string" && !knownSymbols.has(value)) throw new Error(`Feature ${feature.id} refers to unknown symbol ${value}`);
  }
  if (game.math.outcomeGenerator === "reel-strips" && game.math.reelStrips?.length !== game.layout.reels) throw new Error("Reel-strip games require one strip per reel");
  if (game.math.outcomeGenerator === "weighted-grid" && !game.math.symbolWeights) throw new Error("Weighted-grid games require symbolWeights");
  if (game.math.evaluator === "paylines" && !game.math.paylines?.length) throw new Error("Payline games require at least one payline");
  if (game.math.targets.hitRateBps[0] > game.math.targets.hitRateBps[1]) throw new Error("Hit-rate minimum cannot exceed maximum");
  const assetIds = new Set(game.assets.map((asset) => asset.id));
  for (const symbol of game.symbols) {
    if (!assetIds.has(symbol.asset)) throw new Error(`Symbol ${symbol.id} refers to missing asset ${symbol.asset}`);
    if (symbol.animation && !assetIds.has(symbol.animation)) throw new Error(`Symbol ${symbol.id} refers to missing animation ${symbol.animation}`);
  }
  const compatibility = resolveCompatibility(game.features, game.math.evaluator, options.catalog ?? [], options.release ?? false);
  if (!compatibility.compatible) throw new Error(compatibility.errors.join("; "));
  if (options.release && new Date(`${game.jurisdiction.reviewBy}T23:59:59Z`) < (options.now ?? new Date())) {
    throw new Error(`Jurisdiction profile ${game.jurisdiction.profileId} is stale as of ${game.jurisdiction.reviewBy}`);
  }
}

export async function compileGame(source: string, options: CompileOptions = {}): Promise<CompiledGame> {
  const sourcePath = path.resolve(source);
  const value = await resolveSource(sourcePath);
  validateGameConfig(value);
  validateSemantics(value, options);
  const game = value;
  const selected = new Set(game.features.filter((feature) => feature.enabled).map((feature) => feature.id));
  const components = (options.catalog ?? []).filter((component) => selected.has(component.id)).map(({ id, version, status }) => ({ id, version, status }));
  const lock: GameLock = {
    schemaVersion: "2.0",
    gameId: game.id,
    gameVersion: game.version,
    compiledAt: (options.now ?? new Date()).toISOString(),
    source: sourcePath,
    bundleHash: hashValue(game),
    mathHash: hashMathContract(game),
    components,
  };
  if (options.outputDir) {
    const outputDir = path.resolve(options.outputDir);
    await mkdir(outputDir, { recursive: true });
    await writeFile(path.join(outputDir, "game.bundle.json"), canonicalJson(game), "utf8");
    await writeFile(path.join(outputDir, "game.lock.json"), canonicalJson(lock), "utf8");
  }
  return { game, lock };
}
