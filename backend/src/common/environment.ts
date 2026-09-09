import { z } from 'zod';

const productionEnvironment = z.object({
  NODE_ENV: z.literal('production'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  FRONTEND_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  COOKIE_SECURE: z.literal('true'),
  TRUST_PROXY: z.literal('true'),
  REGISTRATION_ENABLED: z.enum(['true', 'false']),
}).passthrough();

export function validateProductionEnvironment(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const result = productionEnvironment.safeParse(process.env);
  if (!result.success) {
    const missingOrInvalid = result.error.issues.map(issue => issue.path.join('.')).join(', ');
    throw new Error(`Invalid production environment: ${missingOrInvalid}`);
  }
  const rejectedFragments = ['changeme', 'change-me', 'development', 'generate-', 'replace-', 'url_encoded'];
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = process.env[name]!.toLowerCase();
    if (value === 'secret' || value === 'password' || rejectedFragments.some(fragment => value.includes(fragment))) {
      throw new Error(`Invalid production environment: ${name} uses an unsafe default`);
    }
  }
  if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('Invalid production environment: JWT secrets must be unique');
  }

  for (const name of ['DATABASE_URL', 'REDIS_URL'] as const) {
    const value = process.env[name]!.toLowerCase();
    if (rejectedFragments.some(fragment => value.includes(fragment))) {
      throw new Error(`Invalid production environment: ${name} uses a placeholder credential`);
    }
  }

  const frontendOrigin = new URL(process.env.FRONTEND_URL!).origin;
  const origins = process.env.CORS_ORIGINS!.split(',').map(value => value.trim()).filter(Boolean);
  if (!origins.length || origins.some(origin => new URL(origin).origin !== origin || !origin.startsWith('https://'))) {
    throw new Error('Invalid production environment: CORS_ORIGINS must contain only HTTPS origins without paths');
  }
  if (!origins.includes(frontendOrigin) || !frontendOrigin.startsWith('https://')) {
    throw new Error('Invalid production environment: FRONTEND_URL must be an allowed HTTPS origin');
  }
  if (new URL(frontendOrigin).hostname === 'example.com') {
    throw new Error('Invalid production environment: FRONTEND_URL uses the documentation domain');
  }
}
