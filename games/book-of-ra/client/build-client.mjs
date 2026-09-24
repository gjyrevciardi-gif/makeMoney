/**
 * Rebuilds player/build/slot-client.js from the vendored presentation sources.
 *
 * Uses only locally installed tooling (the slot-skills Vite install already
 * present beside this workspace); it never installs packages, never writes
 * outside player/build, and never touches game math or backend sources.
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = resolve(here, "..");
const repoRoot = resolve(gameRoot, "../..");
const outFile = join(gameRoot, "player/build/slot-client.js");
const cacheFile = join(gameRoot, ".cache/build-client.json");

const toolkitCandidates = [
  process.env.SLOT_SKILLS_TOOLKIT,
  join(gameRoot, "slot-skills"),
  repoRoot,
].filter(Boolean);

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveToolkit() {
  for (const candidate of toolkitCandidates) {
    if (await exists(join(candidate, "node_modules/vite/dist/node/index.js"))) return candidate;
  }
  throw new Error(
    `No local Vite install found. Looked in: ${toolkitCandidates.join(", ")}. ` +
      "Set SLOT_SKILLS_TOOLKIT to a read-only toolkit checkout.",
  );
}

async function digest(targets) {
  const hash = createHash("sha256");
  async function add(target) {
    const info = await stat(target);
    if (info.isDirectory()) {
      for (const name of (await readdir(target)).sort()) await add(join(target, name));
      return;
    }
    hash.update(relative(repoRoot, target));
    hash.update(await readFile(target));
  }
  for (const target of targets) {
    if (await exists(target)) await add(target);
  }
  return hash.digest("hex");
}

const toolkit = await resolveToolkit();
const inputs = [
  join(here, "build-client.mjs"),
  join(here, "src"),
  join(here, "vendor"),
  join(here, "vite.config.mjs"),
  join(repoRoot, "packages/slot-skills/schema/src/types.ts"),
  join(repoRoot, "packages/slot-skills/runtime/src/types.ts"),
  join(toolkit, "node_modules/vite/package.json"),
];

const signature = await digest(inputs);
if (!process.argv.includes("--force") && (await exists(cacheFile)) && (await exists(outFile)) && (await exists(`${outFile}.map`))) {
  const cached = JSON.parse(await readFile(cacheFile, "utf8"));
  const outputSignature = await digest([outFile, `${outFile}.map`]);
  if (cached.signature === signature && cached.outputSignature === outputSignature) {
    console.log(`slot-client.js up to date (${cached.bytes} bytes)`);
    process.exit(0);
  }
}

const { build } = await import(pathToFileURL(join(toolkit, "node_modules/vite/dist/node/index.js")).href);
await mkdir(dirname(outFile), { recursive: true });
await build({
  configFile: join(here, "vite.config.mjs"),
  logLevel: "warn",
});

const bytes = (await stat(outFile)).size;
await mkdir(dirname(cacheFile), { recursive: true });
await writeFile(
  cacheFile,
  `${JSON.stringify({ signature, outputSignature: await digest([outFile, `${outFile}.map`]), bytes, toolkit }, null, 2)}\n`,
);
console.log(`Built player/build/slot-client.js (${bytes} bytes) from ${relative(repoRoot, here)}`);
