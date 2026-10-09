// PRODUCTION entry: always the OS CSPRNG. No environment switch, fixture or body field can
// enable deterministic draws or outcome selection here.
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from './runtime-core.mjs';
import { createHttpServer } from './http-layer.mjs';
import { createProductionRng } from './runtime-math.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RUN = process.env.LUCKY_RUNTIME_DIR
  || 'C:/Users/Admin/orca/research/game-pack-forensics/runtime/LuckyLadysCharmDX/clean-runtime';
export const CLIENT = 'C:/Users/Admin/orca/research/game-pack-forensics/external/frontend-hunt/files/heidi-luong1109--game/public/games/LuckyLadysCharmDX';
export const PREVIEW = 'C:/Users/Admin/orca/research/game-pack-forensics/previews/LuckyLadysCharmDX';
export const BRIDGE = join(HERE, '..', 'harness', 'recovery-client.js');
const PORT = Number(process.env.LUCKY_RUNTIME_PORT || 8766);

mkdirSync(RUN, { recursive: true });
const SESSION_FILE = join(RUN, 'session-token');
if (!existsSync(SESSION_FILE)) writeFileSync(SESSION_FILE, randomBytes(32).toString('hex'));
export const SESSION_TOKEN = readFileSync(SESSION_FILE, 'utf8').trim();

export function startProduction({ port = PORT, dbName = process.env.LUCKY_RUNTIME_DB || 'lucky-math-runtime.sqlite', startingBalanceCents = 100000 } = {}) {
  const runtime = createRuntime({ dir: RUN, dbName, rngFactory: createProductionRng, config: { startingBalanceCents } });
  const server = createHttpServer({ runtime, port, clientDir: CLIENT, previewDir: PREVIEW, bridgePath: BRIDGE, sessionToken: SESSION_TOKEN });
  return { runtime, server, port };
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  const { runtime, server } = startProduction();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({ listening: `http://127.0.0.1:${PORT}`, db: runtime.config, rng: 'os-csprng' }));
  });
}