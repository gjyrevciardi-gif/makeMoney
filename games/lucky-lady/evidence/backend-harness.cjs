/*
 * Test-only platform entry for bounded original-client browser evidence.
 *
 * It boots the real compiled Nest application (same modules, guards, pipes and
 * controllers as production) against a disposable *_test database, and injects
 * a deterministic outcome seed queue through the Lucky Lady service's DI seam.
 * The seed seam is unreachable from the production entry point: it exists only
 * because this process composes the module graph itself.
 *
 * Usage (after `npm run build` in backend/):
 *   node games/lucky-lady/evidence/backend-harness.cjs
 */
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIST = path.join(ROOT, 'backend', 'dist', 'src');
const PORT = Number(process.env.LUCKY_LADY_HARNESS_PORT ?? 3101);

// Test-only controls must never be composed against an ambient platform DB.
const testDatabase = new URL(process.env.DATABASE_URL || 'invalid:');
if (!['localhost', '127.0.0.1', '[::1]'].includes(testDatabase.hostname)
  || !testDatabase.pathname.toLowerCase().includes('_test')
  || process.env.NODE_ENV === 'production') {
  throw new Error('Lucky Lady evidence requires a loopback *_test database outside production');
}

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.CASINO_CRASH_WORKER_ENABLED = process.env.CASINO_CRASH_WORKER_ENABLED ?? 'false';
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE ?? 'false';

const { Test } = require(path.join(ROOT, 'node_modules', '@nestjs', 'testing'));
const { ValidationPipe } = require(path.join(ROOT, 'node_modules', '@nestjs', 'common'));
const { json } = require(path.join(ROOT, 'node_modules', 'express'));
const cookieParser = require(path.join(ROOT, 'node_modules', 'cookie-parser'));
const { AppModule } = require(path.join(DIST, 'app.module.js'));
const { LUCKY_LADY_OPTIONS } = require(path.join(DIST, 'casino', 'games', 'lucky-lady', 'lucky-lady.adapter.js'));
const { createDeterministicRng } = require(path.join(DIST, 'casino', 'games', 'lucky-lady', 'lucky-lady.math.js'));
const { BigIntInterceptor } = require(path.join(DIST, 'common', 'bigint.interceptor.js'));

const queue = (process.env.LUCKY_LADY_SEEDS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
let draws = 0;
let lastSeed = null;

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LUCKY_LADY_OPTIONS)
    .useValue({
      // Deterministic draws, for the browser evidence only. The production
      // module graph never supplies this provider.
      rngFactory: () => {
        draws += 1;
        lastSeed = queue.length ? queue.shift() : `csprng:${randomBytes(32).toString('hex')}`;
        return createDeterministicRng(lastSeed);
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  // Body and cookie parsing must be registered before Nest mounts its own
  // router, or the controllers would see an unparsed body and no cookies - the
  // platform's own main.ts installs both the same way.
  app.use(json());
  app.use(cookieParser());
  // The real Next launcher page runs on its own origin and calls this API with
  // credentials, exactly as production main.ts allows the frontend origin.
  app.enableCors({
    origin: [process.env.LUCKY_LADY_LAUNCHER_ORIGIN ?? 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalInterceptors(new BigIntInterceptor());

  const express = app.getHttpAdapter().getInstance();
  // Registered before Nest's router so the test-only controls are reachable
  // (Nest's own 404 handler is mounted last).
  express.get('/__test/stats', (_request, response) => {
    response.json({ draws, queued: queue.length, lastSeed });
  });
  express.post('/__test/seeds', (request, response) => {
    const seeds = Array.isArray(request.body && request.body.seeds) ? request.body.seeds : [];
    queue.length = 0;
    for (const seed of seeds) if (typeof seed === 'string' && seed) queue.push(seed);
    response.json({ queued: queue.length });
  });

  await app.init();
  await app.listen(PORT, '127.0.0.1');
  process.stdout.write(`${JSON.stringify({ harness: `http://127.0.0.1:${PORT}`, seeds: queue.length, draws })}\n`);
}

main().catch((error) => {
  process.stderr.write(`harness failed: ${error && error.stack}\n`);
  process.exit(1);
});
