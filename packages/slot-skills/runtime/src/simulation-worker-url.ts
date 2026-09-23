/**
 * Resolves the compiled worker module next to this file.
 *
 * This is the only module that needs `import.meta`, so it is loaded lazily by
 * the parallel simulator. A CommonJS host (the Nest platform, or Jest
 * transpiling the engine for a test) can therefore import the engine without
 * ever parsing this file, and only the ESM build reaches it at runtime.
 */
export default function simulationWorkerUrl(): URL {
  return new URL("./simulation-worker.js", import.meta.url);
}
