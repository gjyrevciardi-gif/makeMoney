import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = resolve(here, "..");
const repoRoot = resolve(gameRoot, "../..");
const vendor = (name) => resolve(here, "vendor", name, "src");

// The vendored sources import one UI-only third-party package. Resolve it from
// whichever read-only local toolkit install is present; nothing is installed.
const thirdPartyRoots = [
  process.env.SLOT_SKILLS_TOOLKIT && resolve(process.env.SLOT_SKILLS_TOOLKIT, "node_modules"),
  resolve(gameRoot, "slot-skills/node_modules"),
  resolve(repoRoot, "node_modules"),
].filter(Boolean);
const thirdParty = (name) => {
  for (const base of thirdPartyRoots) {
    const candidate = resolve(base, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot find read-only dependency "${name}" in: ${thirdPartyRoots.join(", ")}`);
};

/**
 * Bundles the imported MIT-licensed web component sources into the game's
 * static player bundle. Only presentation sources are aliased: the schema entry
 * is the type-only module so no server-side compiler (ajv/yaml) is pulled in.
 */
export default {
  root: here,
  configFile: false,
  resolve: {
    alias: [
      { find: /^@slot-skills\/web-client$/, replacement: resolve(vendor("web-client"), "index.ts") },
      { find: /^@slot-skills\/canvas-effects$/, replacement: resolve(vendor("canvas-effects"), "index.ts") },
      { find: /^@slot-skills\/spine\/browser$/, replacement: resolve(vendor("spine"), "browser.ts") },
      { find: /^@slot-skills\/spine$/, replacement: resolve(vendor("spine"), "index.ts") },
      { find: /^@slot-skills\/schema$/, replacement: resolve(repoRoot, "packages/slot-skills/schema/src/types.ts") },
      { find: /^@slot-skills\/runtime$/, replacement: resolve(repoRoot, "packages/slot-skills/runtime/src/types.ts") },
      { find: /^intl-messageformat$/, replacement: thirdParty("intl-messageformat") },
    ],
  },
  build: {
    outDir: resolve(gameRoot, "player/build"),
    emptyOutDir: false,
    target: "es2022",
    sourcemap: true,
    minify: false,
    lib: {
      entry: resolve(here, "src/index.ts"),
      formats: ["es"],
      fileName: () => "slot-client.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
};
