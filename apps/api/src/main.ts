// MUST be the very first import — see the ordering block comment at the top
// of otel.ts for why (OTel's http/express/nestjs-core instrumentations patch
// Node's module loader; that patch has to land before anything else in this
// process ever `require()`s those modules, which `reflect-metadata`/Nest do
// on the next lines).
import './common/observability/otel';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertJwtSecretsPresent } from './common/config/jwt-secrets';
import { assertProductionSecurityPosture } from './common/config/production-security';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  // `rawBody: true` — needed ONLY by POST /finance/webhooks/stripe (Stripe
  // signs the exact bytes it sent; verifying against the JSON-parsed-then-
  // reserialized req.body would never match). Nest still parses req.body as
  // usual for every route; this additionally captures the original buffer
  // onto req.rawBody. See finance/webhooks/stripe-webhook.controller.ts.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');
  const isProd = process.env.NODE_ENV === 'production';

  // Fail fast (before listening) if signing secrets are unset — never serve with
  // an insecure default (which would let anyone forge tokens for any user/role).
  // Runs after create() so ConfigModule has populated process.env from .env.
  assertJwtSecretsPresent();

  // Multi-instance correctness: rate-limit + idempotency stores need shared Redis.
  if (isProd && !process.env.REDIS_URL && process.env.VPSY_ALLOW_INMEMORY_RATE_LIMIT !== 'true') {
    throw new Error(
      'REDIS_URL is required in production (shared rate-limit/idempotency). ' +
        'Set REDIS_URL or, only for an explicit single-instance demo, VPSY_ALLOW_INMEMORY_RATE_LIMIT=true.',
    );
  }

  // Production PHI posture: demo seed, swagger, virus stub, plaintext PHI, etc.
  assertProductionSecurityPosture();

  app.useGlobalFilters(new ProblemDetailsFilter());

  // Bound JSON/urlencoded bodies (DoS). Blob PUT has its own virus-scan max.
  const jsonLimit = process.env.VPSY_JSON_BODY_LIMIT ?? '1mb';
  app.useBodyParser('json', { limit: jsonLimit });
  app.useBodyParser('urlencoded', { limit: jsonLimit, extended: true });

  // Behind Render/Cloudflare/etc the platform TLS terminator sets X-Forwarded-*.
  // Trusting the first proxy hop makes rate-limit and audit IP attribution correct.
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance?.() as { set?: (k: string, v: unknown) => void } | undefined;
  instance?.set?.('trust proxy', 1);

  // Baseline browser security headers (Helmet-equivalent without a new dep).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    // API returns JSON only — deny script execution if a browser ever navigates here.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Requested-With'],
  });
  // Real-time layer (SP3): explicit Socket.IO adapter for RealtimeGateway.
  app.useWebSocketAdapter(new IoAdapter(app));
  // Validation is handled per-route by ZodValidationPipe against @vpsy/contracts
  // schemas (single source of truth), so no global class-validator pipe is needed.

  // OpenAPI surface is a reconnaissance aid in production — keep it for
  // local/dev and require an explicit opt-in when live.
  if (!isProd || process.env.VPSY_ENABLE_SWAGGER === 'true') {
    const config = new DocumentBuilder()
      .setTitle('VPSY OS API')
      .setDescription('Clinical Psychology Operating System — modular monolith (28 bounded contexts)')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, doc);
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  logger.log(
    `VPSY API listening on :${port}${!isProd || process.env.VPSY_ENABLE_SWAGGER === 'true' ? ' — docs at /api/docs' : ''}`,
  );
}

bootstrap();
