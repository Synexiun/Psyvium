import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { assertJwtSecretsPresent } from './common/config/jwt-secrets';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const logger = new Logger('Bootstrap');

  // Fail fast (before listening) if signing secrets are unset — never serve with
  // an insecure default (which would let anyone forge tokens for any user/role).
  // Runs after create() so ConfigModule has populated process.env from .env.
  assertJwtSecretsPresent();

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  // Real-time layer (SP3): explicit Socket.IO adapter for RealtimeGateway.
  app.useWebSocketAdapter(new IoAdapter(app));
  // Validation is handled per-route by ZodValidationPipe against @vpsy/contracts
  // schemas (single source of truth), so no global class-validator pipe is needed.

  const config = new DocumentBuilder()
    .setTitle('VPSY OS API')
    .setDescription('Clinical Psychology Operating System — modular monolith (28 bounded contexts)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, doc);

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  logger.log(`VPSY API listening on :${port} — docs at /api/docs`);
}

bootstrap();
