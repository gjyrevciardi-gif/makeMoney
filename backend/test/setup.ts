const ensureSafeTestDatabase = () => {
  if (process.env.NODE_ENV !== 'test') {
    process.env.NODE_ENV = 'test';
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Backend tests require DATABASE_URL to point to an isolated test PostgreSQL database. Refusing to fall back to the development database.',
    );
  }

  let databaseName = '';
  try {
    const parsed = new URL(databaseUrl);
    databaseName = parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
  } catch {
    throw new Error(
      'Backend tests require a valid DATABASE_URL. Refusing to run against an unsafe or missing test database.',
    );
  }

  const normalizedName = databaseName.toLowerCase();
  const disallowedNames = ['fools_gold', 'postgres', 'app', 'development', 'dev', 'production', 'public'];

  if (!normalizedName.includes('_test') || disallowedNames.includes(normalizedName)) {
    throw new Error(
      `Unsafe test database name detected: "${databaseName}". Tests must use an explicitly isolated *_test database and must not target the development database.`,
    );
  }

  if (databaseUrl.includes('fools_gold')) {
    throw new Error(
      'Refusing to run backend tests against the development database name "fools_gold". Set DATABASE_URL to a dedicated *_test database instead.',
    );
  }

  if (databaseUrl.includes('localhost:5432')) {
    throw new Error(
      'Refusing to run backend tests against the default local development PostgreSQL port. Set DATABASE_URL to a dedicated isolated test instance.',
    );
  }
};

ensureSafeTestDatabase();

process.env.REDIS_URL ??= 'redis://localhost:56380';
process.env.JWT_ACCESS_SECRET ??= 'integration-test-secret-not-for-production';
// Crash sweeps are driven explicitly through runOnce() with an injected clock,
// so the background timer stays off in tests.
process.env.CASINO_CRASH_WORKER_ENABLED ??= 'false';
// Revealable-password vault key for tests only (32 bytes, base64). Never a real key.
process.env.PASSWORD_VAULT_KEY ??= 'BwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSY=';
// Existing suites register users through the public endpoint; production defaults it off.
process.env.REGISTRATION_ENABLED ??= 'true';
