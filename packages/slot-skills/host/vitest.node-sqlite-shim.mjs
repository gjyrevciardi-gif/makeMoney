/**
 * Vite resolves `node:sqlite` as a file URL and fails to load it on toolchains
 * whose builtin list predates the module (vite 5 / vitest 2). Node itself
 * loads it fine, so the test config aliases the specifier to this shim, which
 * simply re-exports the real builtin. Production code always imports
 * `node:sqlite` directly; this file exists only for the test runner.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite");

export const { DatabaseSync, Session, StatementSync, backup, constants } = sqlite;
export default sqlite;
