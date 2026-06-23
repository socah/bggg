# NestJS Architecture — Modules, Controllers, Providers, Dependency Injection

**Phase:** 2 — Backend Core
**Topic ID:** 2_nestjs_modules
**Date:** 2026-06-23
**SecOps:** No

---

## What Is This?

NestJS is a framework for building Node.js servers in TypeScript. It organises
your application into **modules** — self-contained slices of functionality that
declare what they provide and what they need from other modules. Inside each
module live two kinds of classes: **controllers** (which receive HTTP requests
and send responses) and **providers** (which contain business logic and can be
injected wherever they are needed). The glue that makes this work is
**dependency injection** (DI): instead of a class creating its own dependencies
with `new SomeService()`, it declares what it needs in its constructor and the
NestJS container builds and supplies those dependencies automatically.

---

## Why Does It Matter for This Project?

Every feature in the board game platform — groups, game sessions, BGG sync,
invites — will live in its own NestJS module. Understanding modules means you
know exactly where to add a new endpoint, how to share a service (like an auth
guard) across features without copy-pasting it, and why the app can be tested
one slice at a time in isolation.

---

## The Decision

Chose: NestJS with its built-in module/DI system
Because: It forces a consistent structure from day one. Every developer
(including future-you) knows where to find the controller, the service, and
the database entity for any feature. The DI system also makes unit testing
trivially easy — you just swap in a mock provider.

Alternative: Plain Express with hand-rolled routing
Drawback of alternative: No enforced structure. As the codebase grows,
routing, business logic, and database calls get tangled together. Testing
requires brittle monkey-patching instead of constructor injection.

---

## Worked Example

This example is NOT the project code. It is a standalone mini-app that tracks
a library's books — nothing to do with board games. It isolates the NestJS
concepts clearly.

### Scenario

We want a `/books` endpoint that returns a list of books. We have:
- A `BooksModule` that bundles everything together
- A `BooksController` that handles the HTTP request
- A `BooksService` that holds the business logic (here: the book data)
- An `AppModule` that is the root and imports `BooksModule`

### Code / Configuration

```typescript
// ─── books.service.ts ────────────────────────────────────────────────────────

import { Injectable } from '@nestjs/common';

// @Injectable() marks this class as something the DI container can manage.
// Without this decorator NestJS will not know it can create and inject it.
@Injectable()
export class BooksService {
  // Hard-coded data here — in the real project this would call TypeORM.
  private readonly books = [
    { id: 1, title: 'Dune' },
    { id: 2, title: 'Foundation' },
  ];

  findAll() {
    return this.books;
  }
}
```

```typescript
// ─── books.controller.ts ─────────────────────────────────────────────────────

import { Controller, Get } from '@nestjs/common';
import { BooksService } from './books.service';

// @Controller('books') tells NestJS: all routes in this class are
// prefixed with /books. The string is the route prefix, not the class name.
@Controller('books')
export class BooksController {
  // Constructor injection: NestJS reads this parameter type (BooksService),
  // finds the matching provider in the module's DI container, and passes
  // the already-created instance in. We never call `new BooksService()`.
  constructor(private readonly booksService: BooksService) {}

  // @Get() with no argument maps to GET /books (the prefix from above).
  @Get()
  findAll() {
    // Delegate to the service — the controller's only job is HTTP in/out.
    return this.booksService.findAll();
  }
}
```

```typescript
// ─── books.module.ts ─────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';

@Module({
  // controllers: classes that handle HTTP routes. NestJS instantiates them
  // and registers their routes with the Express (or Fastify) adapter.
  controllers: [BooksController],

  // providers: classes available for injection inside this module.
  // Listing BooksService here is what allows the controller to receive it.
  providers: [BooksService],

  // exports: providers other modules can inject if they import this module.
  // We export BooksService in case another module (e.g. a stats module)
  // needs to call findAll() too — without this, they cannot.
  exports: [BooksService],
})
export class BooksModule {}
```

```typescript
// ─── app.module.ts ───────────────────────────────────────────────────────────

import { Module } from '@nestjs/common';
import { BooksModule } from './books/books.module';

// AppModule is the root. NestJS starts here and builds the whole DI graph.
@Module({
  // Importing BooksModule makes its exported providers available to any
  // module that also imports BooksModule — and registers its routes.
  imports: [BooksModule],
})
export class AppModule {}
```

```typescript
// ─── main.ts ─────────────────────────────────────────────────────────────────

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // NestFactory reads AppModule, resolves the full dependency graph,
  // instantiates every provider exactly once, and starts the HTTP server.
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### What Is Happening Step by Step

1. **`main.ts` calls `NestFactory.create(AppModule)`** — NestJS reads
   `AppModule` and sees it imports `BooksModule`.

2. **NestJS processes `BooksModule`** — it sees `BooksService` in `providers`
   and creates exactly one instance of it (singleton by default). It sees
   `BooksController` in `controllers` and creates one instance, passing the
   already-created `BooksService` into its constructor automatically.

3. **Route registration** — NestJS inspects `BooksController`, finds `@Get()`
   on `findAll`, and registers `GET /books` with the HTTP adapter.

4. **A request arrives** — `GET /books` hits the HTTP layer, NestJS routes it
   to `BooksController.findAll()`, which calls `this.booksService.findAll()`,
   which returns the array. NestJS serialises it to JSON and sends the response.

5. **DI is a graph, not a chain** — if `BooksService` itself needed another
   service (say, a `LoggerService`), it would just declare it in its own
   constructor. NestJS resolves the whole graph before starting the server, so
   circular dependencies surface at startup, not at runtime.

### What Would Break If You Changed X?

**Remove `BooksService` from the `providers` array in `BooksModule`:**
NestJS throws `Nest can't resolve dependencies of the BooksController (?).
Please make sure that the argument BooksService at index [0] is available in
the BooksModule context.` — at startup, before any request is ever handled.
This is a feature: misconfiguration is caught immediately, not buried in a
runtime error six requests later.

---

## Now Apply It

In our board game platform, the pattern looks exactly like this for every
feature. When we build the `groups` feature next, we will create:

- `src/groups/groups.module.ts` — declares the module, imports TypeORM entity
- `src/groups/groups.controller.ts` — handles `GET /groups`, `POST /groups`, etc.
- `src/groups/groups.service.ts` — contains the database queries via TypeORM

Files to look at after this note (once generated):
- `src/app.module.ts` — the root; watch how each feature module is imported here
- `src/groups/groups.module.ts` — the blueprint for every future feature module
- `src/groups/groups.service.ts` — where DI of the TypeORM repository happens

---

## Checkpoint Questions

1. In your own words, what is the difference between a **controller** and a
   **provider**? Why does NestJS separate them?

2. If a request comes in for `GET /books` and `BooksService` is listed in
   `providers` but NOT in the `BooksModule`'s `controllers` array... wait,
   that's backwards. Let me rephrase: if `BooksController` is NOT listed in
   `controllers` but IS in `providers`, what happens? Why?

3. You add a `StatsModule` that needs to count how many books exist. It wants
   to call `BooksService.findAll()`. What two things must you do to make that
   work?

4. What does the `private readonly` in `constructor(private readonly
   booksService: BooksService)` actually do? What would change if you dropped
   `readonly`?

5. NestJS creates providers as singletons by default. What does that mean in
   practice — specifically, if two controllers both inject `BooksService`, how
   many instances of `BooksService` exist at runtime?

---

## Rewrite Exercise

`rewrite: true` — this topic is important enough to practise from memory.

After we generate the initial module files, delete them and recreate them
without looking at the generated code. Use this note as a concept reference,
not a code reference.

Focus on: getting the `@Module()` decorator right — specifically which array
(`controllers`, `providers`, `exports`) each class belongs in, and why.
That's the part most people get wrong the first time.

It is fine if your version differs from the generated one — what matters is
that you can explain every line you write.

---

## Summary

[Filled in after checkpoint is complete.]

Built: —
Demonstrated understanding of: —
To revisit: —
