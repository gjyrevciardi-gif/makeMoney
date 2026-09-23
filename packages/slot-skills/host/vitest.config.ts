import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `node:sqlite` is a `node:`-only builtin that vite 5 cannot externalise, so it
// is aliased to a shim that re-exports the real module. See
// `vitest.node-sqlite-shim.mjs`.
const nodeSqliteShim = fileURLToPath(new URL("./vitest.node-sqlite-shim.mjs", import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: "node:sqlite", replacement: nodeSqliteShim }] },
  test: { environment: "node" },
});
