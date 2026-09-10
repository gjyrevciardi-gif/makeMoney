import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import {
  resolveBodyLimit,
  resolveCorsOrigins,
  resolveEnvironment,
  resolveTrustProxy,
  validateProductionEnvironment,
} from './common/environment';
import { installGracefulShutdown } from './common/graceful-shutdown';

// Behind a reverse proxy the upstream keep-alive must outlive the proxy's own,
// otherwise the proxy reuses a connection Node is closing and the client sees a
// 502. Caddy's default is well below this.
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const HEADERS_TIMEOUT_MS = 66_000;

async function bootstrap() {
  validateProductionEnvironment();
  const environment = resolveEnvironment();
  const isProduction = environment === 'production';

  const app = await NestFactory.create(AppModule);

  const trustProxy = resolveTrustProxy();
  const httpAdapter = app.getHttpAdapter().getInstance();
  httpAdapter.set('trust proxy', trustProxy);
  // Advertising the framework only helps someone match a CVE to this host.
  httpAdapter.disable('x-powered-by');

  app.use(helmet({
    // The API serves JSON to a separate origin, so a document CSP does nothing
    // here, while an explicit CORP keeps other sites from embedding responses.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: isProduction ? 'same-site' : 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
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
  const server = await app.listen(port, process.env.HOST ?? '0.0.0.0');
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;

  process.stdout.write(`${JSON.stringify({
    event: 'APPLICATION_STARTED',
    environment,
    port,
    trustProxy,
    bodyLimit,
  })}\n`);
}
void bootstrap();
