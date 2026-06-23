// reflect-metadata must be the very first import in the application.
// NestJS decorators (@Injectable, @Controller, etc.) store type metadata
// at class definition time using the Reflect API. If this import is missing
// or comes after any NestJS import, decorators silently stop working.
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // NestFactory.create() reads AppModule, walks the full import tree,
  // resolves every provider dependency, creates singleton instances,
  // and registers all controller routes before the server starts accepting
  // connections. Any misconfiguration (missing provider, circular dep) throws
  // here — never silently at request time.
  const app = await NestFactory.create(AppModule);

  // Read the port from the environment so the same image works in dev,
  // staging, and production without code changes.
  const port = process.env.PORT ?? 3000;

  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

bootstrap();
