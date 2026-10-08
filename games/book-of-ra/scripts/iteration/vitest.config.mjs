import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = resolve(here, "../..");
const repoRoot = resolve(gameRoot, "../..");
const toolkit = resolve(gameRoot, "slot-skills/node_modules");

/**
 * Exercises the repository's vendored @slot-skills sources with the locally
 * installed toolkit toolchain. Only module resolution is configured here; no
 * package is installed and no source is modified.
 */
export default {
  root: repoRoot,
  resolve: {
    alias: [
      { find: /^@slot-skills\/features$/, replacement: resolve(repoRoot, "packages/slot-skills/features/src/index.ts") },
      { find: /^@slot-skills\/math$/, replacement: resolve(repoRoot, "packages/slot-skills/math/src/index.ts") },
      { find: /^@slot-skills\/runtime$/, replacement: resolve(repoRoot, "packages/slot-skills/runtime/src/index.ts") },
      { find: /^@slot-skills\/schema$/, replacement: resolve(repoRoot, "packages/slot-skills/schema/src/index.ts") },
      { find: /^ajv\/dist\/2020\.js$/, replacement: resolve(toolkit, "ajv/dist/2020.js") },
      { find: /^ajv$/, replacement: resolve(toolkit, "ajv") },
      { find: /^yaml$/, replacement: resolve(toolkit, "yaml") },
    ],
  },
  test: {
    include: ["schema", "math", "features", "runtime", "host"].map((name) =>
      resolve(repoRoot, `packages/slot-skills/${name}/src/**/*.test.ts`).replaceAll("\\", "/"),
    ),
    environment: "node",
  },
};
