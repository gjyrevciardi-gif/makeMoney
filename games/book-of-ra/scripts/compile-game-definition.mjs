#!/usr/bin/env node
/**
 * Recompiles the game definition served to the player shell.
 *
 * It compiles `book-of-the-sands/game.yaml` with the vendored schema compiler
 * and the vendored feature catalog, so `build/game.bundle.json` and
 * `build/game.lock.json` cannot drift from the mathematics the backend and the
 * simulator actually run. Visual assets are untouched: only the definition and
 * its hashes are rewritten.
 *
 * Usage: node games/book-of-ra/scripts/compile-game-definition.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileGame } from "@slot-skills/schema";
import { featureCatalog } from "@slot-skills/features";

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(here, "../book-of-the-sands");

const compiled = await compileGame(path.join(gameDir, "game.yaml"), {
  catalog: featureCatalog,
  outputDir: path.join(gameDir, "build"),
});

process.stdout.write(
  `compiled ${compiled.lock.gameId} ${compiled.lock.gameVersion}\n`
  + `bundleHash ${compiled.lock.bundleHash}\n`
  + `mathHash   ${compiled.lock.mathHash}\n`
  + `components ${compiled.lock.components.map((component) => component.id).join(", ")}\n`,
);
