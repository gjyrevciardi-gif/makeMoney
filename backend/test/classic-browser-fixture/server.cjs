'use strict';

// Test-only Classic process. Production `main.js` never loads this file.
// The backend runtime image copies dist and prisma, not backend/test.
// There is no HTTP route for choosing an outcome. The browser cannot pass a seed.
if (process.env.NODE_ENV === 'production') {
  process.stderr.write('scripted classic backend refuses NODE_ENV=production\n');
  process.exit(1);
}
if (process.env.BOOK_CLASSIC_E2E_SCRIPTED_RNG !== '1') {
  process.stderr.write('scripted classic backend requires BOOK_CLASSIC_E2E_SCRIPTED_RNG=1\n');
  process.exit(1);
}

const { writeFileSync, readFileSync } = require('node:fs');
const path = require('node:path');

const databaseName = (() => {
  try {
    return new URL(process.env.DATABASE_URL || '').pathname.replace(/^\/+/, '').split('/')[0];
  } catch {
    return '';
  }
})();
if (!databaseName.toLowerCase().includes('classic') || databaseName.toLowerCase() === 'postgres') {
  process.stderr.write('scripted classic backend refuses this database name\n');
  process.exit(1);
}

require('reflect-metadata');

const { createCallBudgetRng } = require('./classic-scripted-rng.cjs');

// Paid 1x9 fixtures already pinned by the Classic integration tests.
// classic-2 is a line win, classic-0 is a loss, classic-2879 is one retrigger.
const SEEDS = ['classic-2', 'classic-0', 'classic-2879'];
const DIST = path.join(__dirname, '..', '..', 'dist', 'src');

function load(relative) {
  return require(path.join(DIST, relative));
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const checker = new PrismaClient();
  try {
    const pointer = await checker.gameActiveMathProfile.findUnique({ where: { gameId: 'book-of-ra-classic' } });
    if (pointer && pointer.kind !== 'DEFAULT' && pointer.profileRowId) {
      process.stderr.write('scripted classic backend refuses a non-default active profile\n');
      process.exit(1);
    }
  } finally {
    await checker.$disconnect();
  }

  const { playRound } = load('casino/games/book-of-ra-classic/classic.engine.js');
  const { defaultClassicProfile } = load('casino/games/book-of-ra-classic/classic.math-adapter.js');
  const { createSimulationRng } = load('casino/platform/math-control/math-control.random.js');
  const profile = defaultClassicProfile().payload;

  const measured = SEEDS.map((seed) => {
    const stream = createSimulationRng(seed);
    let calls = 0;
    const round = playRound(profile, 1, 9, (upper) => {
      calls += 1;
      return stream.int(0, upper - 1);
    });
    return { calls, totalWin: round.totalWin, freeSpins: round.freeSpins, retriggers: round.retriggers };
  });
  const [lineWin, loss, feature] = measured;
  if (lineWin.freeSpins !== 0 || lineWin.totalWin <= 0) {
    process.stderr.write('scripted classic backend line-win fixture did not match\n');
    process.exit(1);
  }
  if (loss.freeSpins !== 0 || loss.totalWin !== 0) {
    process.stderr.write('scripted classic backend loss fixture did not match\n');
    process.exit(1);
  }
  if (feature.freeSpins !== 20 || feature.retriggers !== 1) {
    process.stderr.write('scripted classic backend feature fixture did not match\n');
    process.exit(1);
  }

  const budgets = measured.map((entry) => entry.calls);
  const budgetTotal = budgets.reduce((sum, value) => sum + value, 0);
  const streams = SEEDS.map((seed) => createSimulationRng(seed));
  const rng = createCallBudgetRng(budgets, (span, upper) => streams[span].int(0, upper - 1));
  const rngFile = process.env.BOOK_CLASSIC_E2E_RNG_FILE;
  const publish = () => {
    if (!rngFile) return;
    writeFileSync(rngFile, `${JSON.stringify({ calls: rng.calls(), budgetTotal })}\n`);
  };
  const counting = (upper) => {
    const value = rng(upper);
    publish();
    return value;
  };
  publish();

  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { json, urlencoded } = require('express');
  const helmet = require('helmet');
  const cookieParser = require('cookie-parser');
  const { AppModule } = load('app.module.js');
  const { ClassicAdapter } = load('casino/games/book-of-ra-classic/classic.adapter.js');
  const {
    resolveBodyLimit,
    resolveCorsOrigins,
    resolveEnvironment,
    resolveTrustProxy,
    validateProductionEnvironment,
  } = load('common/environment.js');
  const { installGracefulShutdown } = load('common/graceful-shutdown.js');

  validateProductionEnvironment();
  const app = await NestFactory.create(AppModule);
  const adapter = app.get(ClassicAdapter);
  if (adapter.options && adapter.options.rng) {
    process.stderr.write('scripted classic backend found an rng already configured\n');
    process.exit(1);
  }
  adapter.options = { rng: counting };

  const faultFile = process.env.BOOK_CLASSIC_E2E_FAULT_FILE;
  app.use((request, response, next) => {
    let fault = '';
    if (faultFile) {
      try { fault = readFileSync(faultFile, 'utf8').trim(); } catch { fault = ''; }
    }
    if (fault === 'gameplay-500' && request.method === 'POST' && request.headers['x-pilot-version']) {
      response.status(500).type('application/json').send(JSON.stringify({
        responseEvent: 'error',
        reason: 'test fault',
      }));
      return;
    }
    next();
  });

  const isProduction = resolveEnvironment() === 'production';
  const httpAdapter = app.getHttpAdapter().getInstance();
  httpAdapter.set('trust proxy', resolveTrustProxy());
  httpAdapter.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: isProduction ? 'same-site' : 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: false,
  }));
  app.use(cookieParser());
  const bodyLimit = resolveBodyLimit();
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: false, limit: bodyLimit }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({
    origin: resolveCorsOrigins(),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  installGracefulShutdown(app);

  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  process.stdout.write(`${JSON.stringify({
    event: 'SCRIPTED_CLASSIC_BACKEND',
    port,
    budgetTotal,
    featureFreeSpins: feature.freeSpins,
    featureRetriggers: feature.retriggers,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
