// reflect-metadata must be the very first import in the application.
// NestJS decorators (@Injectable, @Controller, etc.) store type metadata
// at class definition time using the Reflect API. If this import is missing
// or comes after any NestJS import, decorators silently stop working.
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  // NestFactory.create() reads AppModule, walks the full import tree,
  // resolves every provider dependency, creates singleton instances,
  // and registers all controller routes before the server starts accepting
  // connections. Any misconfiguration (missing provider, circular dep) throws
  // here — never silently at request time.
  const app = await NestFactory.create(AppModule);

  // Nest's built-in WebSocket adapter uses the raw 'ws' library, which has
  // no concept of rooms or the 'auth' handshake field ChatGateway depends
  // on. Without this line, @WebSocketGateway would silently fall back to
  // 'ws' semantics and client.handshake.auth.token would always be undefined.
  app.useWebSocketAdapter(new IoAdapter(app));

  // Registered globally so every handler in the app validates its DTOs
  // automatically — no need to add @UsePipes() to each controller.
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,             // strip properties not declared in the DTO
    forbidNonWhitelisted: true,  // throw 400 if unknown properties are sent
    transform: true,             // coerce plain JSON objects to DTO class instances
  }));

  // Read the port from the environment so the same image works in dev,
  // staging, and production without code changes.
  // CORS: allow only the specific frontend origin, never a wildcard.
  // CORS_ORIGIN is set per-environment (.env.dev, production env vars).
  // Without this, a page at evil.com could make credentialed requests to
  // the API using the victim's browser token — a CSRF-adjacent attack.
  app.enableCors({
    origin: process.env.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = process.env.PORT ?? 3000;

  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

bootstrap();
