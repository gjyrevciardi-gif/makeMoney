import {
  resolveBodyLimit,
  resolveCorsOrigins,
  resolveEnvironment,
  resolveTrustProxy,
  validateProductionEnvironment,
} from '../src/common/environment';

const STRONG_ACCESS = 'Kq7pZ2vX9mB4nR6tW1yH8jL3cF5dG0sA';
const STRONG_REFRESH = 'Tz4wQ8eR1uY6iO3pA9sD7fG2hJ5kL0nM';

const VALID_PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:s3cr3t@postgres:5432/fools_gold?schema=public',
  REDIS_URL: 'redis://:c4ch3@redis:6379',
  JWT_ACCESS_SECRET: STRONG_ACCESS,
  JWT_REFRESH_SECRET: STRONG_REFRESH,
  FRONTEND_URL: 'https://app.foolsgold.club',
  CORS_ORIGINS: 'https://app.foolsgold.club',
  COOKIE_SECURE: 'true',
  TRUST_PROXY: 'true',
  REGISTRATION_ENABLED: 'false',
  PORT: '3001',
} as const;

/**
 * Replaces the process environment for one assertion. The suite itself runs with
 * NODE_ENV=test against an isolated database, so every production case has to be
 * simulated rather than actually entered.
 */
function withEnvironment(overrides: Record<string, string | undefined>, assertion: () => void) {
  const original = process.env;
  process.env = { ...overrides } as NodeJS.ProcessEnv;
  try {
    assertion();
  } finally {
    process.env = original;
  }
}

const production = (overrides: Record<string, string | undefined> = {}) => ({
  ...VALID_PRODUCTION,
  ...overrides,
});

describe('environment separation', () => {
  it('accepts only the three known environments', () => {
    expect(resolveEnvironment('development')).toBe('development');
    expect(resolveEnvironment('test')).toBe('test');
    expect(resolveEnvironment('production')).toBe('production');
  });

  it('falls back to development when NODE_ENV is unset', () => {
    withEnvironment({}, () => expect(resolveEnvironment()).toBe('development'));
  });

  it('rejects an unrecognised NODE_ENV rather than assuming development', () => {
    expect(() => resolveEnvironment('prod')).toThrow(/Invalid NODE_ENV/);
    expect(() => resolveEnvironment('staging')).toThrow(/Invalid NODE_ENV/);
  });

  it('skips production validation outside production', () => {
    for (const environment of ['development', 'test']) {
      withEnvironment({ NODE_ENV: environment }, () => {
        expect(() => validateProductionEnvironment()).not.toThrow();
      });
    }
  });

  it('refuses to run production against a test database', () => {
    withEnvironment(
      production({ DATABASE_URL: 'postgresql://app:s3cr3t@postgres:5432/fools_gold_test' }),
      () => expect(() => validateProductionEnvironment()).toThrow(/test resource/),
    );
  });
});

describe('production environment validation', () => {
  it('accepts a fully configured production environment', () => {
    withEnvironment(production(), () => {
      expect(() => validateProductionEnvironment()).not.toThrow();
    });
  });

  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
    'CORS_ORIGINS',
    'COOKIE_SECURE',
    'TRUST_PROXY',
    'REGISTRATION_ENABLED',
  ])('fails fast when %s is missing', name => {
    withEnvironment(production({ [name]: undefined }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/Invalid production environment/);
    });
  });

  it('requires secure cookies and a declared proxy', () => {
    withEnvironment(production({ COOKIE_SECURE: 'false' }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/COOKIE_SECURE/);
    });
    withEnvironment(production({ TRUST_PROXY: 'false' }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/TRUST_PROXY/);
    });
  });

  it('accepts the numeric proxy hop count the production compose file sets', () => {
    // docker-compose.prod.yml passes TRUST_PROXY="1". An earlier revision only
    // accepted the literal "true", so the container failed validation and the
    // backend could not start at all behind its own reverse proxy.
    for (const hops of ['1', '2', '10', 'true']) {
      withEnvironment(production({ TRUST_PROXY: hops }), () => {
        expect(() => validateProductionEnvironment()).not.toThrow();
      });
    }
  });

  it.each(['0', '-1', '11', 'all', 'yes', ''])(
    'rejects TRUST_PROXY=%p, which would disable or over-trust forwarding',
    value => {
      withEnvironment(production({ TRUST_PROXY: value }), () => {
        expect(() => validateProductionEnvironment()).toThrow(/TRUST_PROXY/);
      });
    },
  );

  it('requires HTTPS origins that match the frontend', () => {
    withEnvironment(production({ CORS_ORIGINS: 'http://app.foolsgold.club' }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/HTTPS origins/);
    });
    withEnvironment(production({ CORS_ORIGINS: 'https://elsewhere.example.org' }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/allowed HTTPS origin/);
    });
    withEnvironment(
      production({ FRONTEND_URL: 'https://example.com', CORS_ORIGINS: 'https://example.com' }),
      () => expect(() => validateProductionEnvironment()).toThrow(/documentation domain/),
    );
  });

  it('rejects loopback and non-PostgreSQL datastores', () => {
    withEnvironment(
      production({ DATABASE_URL: 'postgresql://app:s3cr3t@localhost:5432/fools_gold' }),
      () => expect(() => validateProductionEnvironment()).toThrow(/loopback/),
    );
    withEnvironment(production({ REDIS_URL: 'redis://:c4ch3@127.0.0.1:6379' }), () =>
      expect(() => validateProductionEnvironment()).toThrow(/loopback/),
    );
    withEnvironment(
      production({ DATABASE_URL: 'mysql://app:s3cr3t@db:3306/fools_gold' }),
      () => expect(() => validateProductionEnvironment()).toThrow(/PostgreSQL/),
    );
  });

  it('rejects a placeholder credential left in a datastore URL', () => {
    withEnvironment(
      production({ DATABASE_URL: 'postgresql://app:generate-a-long-random-value@postgres:5432/fools_gold' }),
      () => expect(() => validateProductionEnvironment()).toThrow(/placeholder credential/),
    );
  });

  it('rejects an out-of-range PORT and a malformed BODY_LIMIT', () => {
    withEnvironment(production({ PORT: '0' }), () =>
      expect(() => validateProductionEnvironment()).toThrow(/PORT/),
    );
    withEnvironment(production({ BODY_LIMIT: 'enormous' }), () =>
      expect(() => validateProductionEnvironment()).toThrow(/BODY_LIMIT/),
    );
  });
});

describe('weak JWT secret rejection', () => {
  it('rejects secrets shorter than 32 characters', () => {
    withEnvironment(production({ JWT_ACCESS_SECRET: 'Kq7pZ2vX9mB4nR6t' }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/Invalid production environment/);
    });
  });

  it.each([
    ['an unreplaced example placeholder', 'replace-with-at-least-32-random-characters'],
    ['a generation instruction', 'generate-at-least-32-random-characters!!'],
    ['a repeated character', 'a'.repeat(48)],
    ['a repeated short block', 'abcd'.repeat(12)],
    ['a repeated weak word', 'secretsecretsecretsecretsecretsecret'],
    ['a low-entropy digit run', '01230123012301230123012301230123'],
  ])('rejects %s', (_label, secret) => {
    withEnvironment(production({ JWT_ACCESS_SECRET: secret }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/Invalid production environment/);
    });
  });

  it('rejects whitespace padding used to reach the length floor', () => {
    withEnvironment(production({ JWT_ACCESS_SECRET: `  ${STRONG_ACCESS}` }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/whitespace/);
    });
  });

  it('requires the access and refresh secrets to differ', () => {
    withEnvironment(production({ JWT_REFRESH_SECRET: STRONG_ACCESS }), () => {
      expect(() => validateProductionEnvironment()).toThrow(/must be unique/);
    });
  });
});

describe('derived runtime settings', () => {
  it('clamps the body limit to a safe default when unset or malformed', () => {
    expect(resolveBodyLimit(undefined)).toBe('1mb');
    expect(resolveBodyLimit('unbounded')).toBe('1mb');
    expect(resolveBodyLimit('512KB')).toBe('512kb');
  });

  it('translates TRUST_PROXY into an express hop count', () => {
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy('true')).toBe(1);
    expect(resolveTrustProxy('2')).toBe(2);
    // A nonsense value trusts a single hop rather than trusting everything.
    expect(resolveTrustProxy('all')).toBe(1);
  });

  it('splits configured CORS origins', () => {
    withEnvironment({ CORS_ORIGINS: 'https://a.example, https://b.example ' }, () => {
      expect(resolveCorsOrigins()).toEqual(['https://a.example', 'https://b.example']);
    });
  });
});
