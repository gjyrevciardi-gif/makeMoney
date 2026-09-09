// The suite runs many Nest applications in one process, each with its own
// Prisma client. Prisma's default pool is sized from the CPU count, so without
// an explicit bound the combined pools exhaust PostgreSQL's connection limit.
process.env.DATABASE_URL ??= 'postgresql://fools_gold:fools_gold@localhost:5432/fools_gold?schema=public&connection_limit=5&pool_timeout=30';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.JWT_ACCESS_SECRET ??= 'integration-test-secret-not-for-production';
// Crash sweeps are driven explicitly through runOnce() with an injected clock,
// so the background timer stays off in tests.
process.env.CASINO_CRASH_WORKER_ENABLED ??= 'false';
