# Guards and Pipes — Validation, Transport-Agnostic JWT Auth Guard

**Phase:** 2 — Backend Core
**Topic ID:** `2_guards_pipes`
**Date:** 2026-06-26
**SecOps:** Yes

---

## What Is This?

**Guards** are NestJS classes that decide whether an incoming request is
allowed to reach a route handler. Think of them as a bouncer at the door:
they run before the controller method and can block the request entirely
by returning `false` or throwing an exception.

**Pipes** transform or validate the data that arrives in a request (route
params, query strings, request bodies). They run after the guard but before
the controller handler, so by the time your controller sees the data, it has
already been checked and shaped into the type you expect.

Together they implement two of the most important concerns in any API:
*"Is the caller allowed to do this?"* (guard) and *"Is the data they sent
valid?"* (pipe).

---

## Why Does It Matter for This Project?

Every route that touches a group, review, or play session must be protected
by the auth guard — unauthenticated users must not reach those handlers at
all. Pipes ensure that UUIDs are actually UUIDs and that request bodies
match the expected shape before any database call is made. Because the auth
guard is written transport-agnostically, the exact same guard will protect
WebSocket connections when group chat is added in Phase 3 — no duplication.

---

## The Decision

**Chose:** A custom `AuthGuard` that extracts the JWT via a private
`extractToken(context)` method that branches on `context.getType()`.

**Because:** When WebSockets are added, the same guard needs to work
without modification — it will just add a `'ws'` branch. This avoids
duplicating token validation logic across HTTP and WS guards.

**Alternative:** Use NestJS Passport's built-in `@nestjs/passport` with a
`JwtStrategy`. It works, but it is tightly coupled to the HTTP request
object (`req.user`) and requires a separate strategy file for WebSockets.
For a project that will add WebSocket auth later, the transport-agnostic
pattern is cleaner and teaches the underlying `ExecutionContext` API.

**For validation, chose:** NestJS's built-in `ValidationPipe` (global) +
`class-validator` decorators on DTO classes.

**Because:** `ValidationPipe` is the idiomatic NestJS approach, integrates
with `class-transformer` for type coercion, and is zero-config once
registered globally. The alternative (validating manually in each handler)
is repetitive and error-prone.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that shows just these concepts with a fictional "todo" API.

### Scenario

A `TodosController` has a `POST /todos` endpoint that should:
1. Reject unauthenticated requests (guard)
2. Validate that the request body has a non-empty `title` string (pipe)

### Code / Configuration

```typescript
// ── auth.guard.ts ──────────────────────────────────────────────────────────

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthGuard implements CanActivate {
  // canActivate is the single method the CanActivate interface requires.
  // NestJS calls it before every handler this guard protects.
  // It must return true (allow) or false / throw (deny).
  canActivate(context: ExecutionContext): boolean {
    const token = this.extractToken(context);
    if (!token) throw new UnauthorizedException('No token provided');

    try {
      // jwt.verify throws if the token is expired or the signature is wrong.
      // The second argument is the secret used to sign the token.
      const payload = jwt.verify(token, process.env.JWT_SECRET!);
      
      // Attach the decoded payload to the request so controllers can read
      // req.user without decoding the JWT again.
      const request = context.switchToHttp().getRequest();
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // Private helper — the only method that "knows" about transport types.
  // This is the key decision: all token-extraction logic lives here so
  // that canActivate stays transport-agnostic.
  private extractToken(context: ExecutionContext): string | null {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest();
      // Authorization: Bearer <token>  →  split on space, take index 1
      return request.headers.authorization?.split(' ')[1] ?? null;
    }
    if (context.getType() === 'ws') {
      // Socket.io clients send auth data in handshake.auth
      const client = context.switchToWs().getClient();
      return client.handshake?.auth?.token ?? null;
    }
    return null; // unknown transport — deny
  }
}


// ── create-todo.dto.ts ─────────────────────────────────────────────────────

import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

// A DTO (Data Transfer Object) is just a class that describes the shape of
// incoming data. class-validator decorators declare the rules.
export class CreateTodoDto {
  @IsString()         // must be a string
  @IsNotEmpty()       // must not be empty or whitespace
  @MaxLength(200)     // must not exceed 200 characters
  title: string;
}


// ── todos.controller.ts ────────────────────────────────────────────────────

import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CreateTodoDto } from './create-todo.dto';

@Controller('todos')
export class TodosController {
  // @UseGuards runs AuthGuard before this entire controller.
  // It could also be placed on a single method if only one route needs auth.
  @UseGuards(AuthGuard)
  @Post()
  create(@Body() body: CreateTodoDto, @Req() req: any) {
    // By the time we get here:
    // - AuthGuard has verified the JWT and attached req.user
    // - ValidationPipe has ensured body.title is a non-empty string ≤ 200 chars
    // If either check failed, this method was never called.
    return { message: `Todo created by ${req.user.sub}`, title: body.title };
  }
}


// ── main.ts (bootstrap) ────────────────────────────────────────────────────

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Registering ValidationPipe globally means every handler in the entire
  // app validates its incoming DTOs — you never have to remember to add it
  // per-route.
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,      // strip any properties not declared in the DTO
    forbidNonWhitelisted: true, // throw 400 if unknown properties are sent
    transform: true,      // coerce plain JSON to DTO class instances
  }));

  await app.listen(3000);
}
bootstrap();
```

### What Is Happening Step by Step

1. **Request arrives** at `POST /todos` with header `Authorization: Bearer eyJ...`
   and body `{ "title": "Buy milk", "hack": "injection" }`.

2. **Guard runs first.** `canActivate` calls `extractToken`. Because
   `context.getType() === 'http'`, it reads `request.headers.authorization`
   and splits off the token. `jwt.verify` validates the signature and expiry.
   The decoded payload is attached to `request.user`. Guard returns `true`.

3. **Pipe runs second.** `ValidationPipe` sees that the handler expects a
   `CreateTodoDto`. It instantiates the class and runs `class-validator` on it.
   `title: "Buy milk"` passes all three decorators. `hack: "injection"` is an
   unknown property — because `forbidNonWhitelisted: true`, the pipe throws a
   `400 Bad Request` before the handler is called.

4. **Handler runs last**, receiving a clean, validated `CreateTodoDto` and a
   `req.user` already decoded.

### What Would Break If You Changed X?

If you removed `whitelist: true` and `forbidNonWhitelisted: true` from
`ValidationPipe`, an attacker could send extra fields in the request body.
Depending on how the service uses the DTO, those extra fields might be passed
to a TypeORM `save()` call, potentially overwriting fields the user should
not control — for example, sending `{ "title": "x", "userId": "other-user" }`.
This is a form of mass assignment vulnerability.

---

## Now Apply It

In the board game platform this will be applied to:

- [apps/api/src/auth/auth.guard.ts](apps/api/src/auth/auth.guard.ts) — the guard we build here; note the `extractToken` method branching on context type
- [apps/api/src/main.ts](apps/api/src/main.ts) — where `useGlobalPipes(new ValidationPipe(...))` is registered
- [apps/api/src/groups/dto/create-group.dto.ts](apps/api/src/groups/dto/create-group.dto.ts) — example DTO with `class-validator` decorators
- [apps/api/src/groups/groups.controller.ts](apps/api/src/groups/groups.controller.ts) — where `@UseGuards(AuthGuard)` protects group routes

---

## SecOps Notes

**Security property:** Token authenticity and integrity. By verifying the JWT
signature in the guard, we ensure that `req.user` can only be populated by a
token signed with our secret — it cannot be forged by sending an arbitrary
JSON payload.

**What attack does this mitigate?**
Without the guard, any request to a protected endpoint succeeds regardless of
whether the caller is authenticated. An unauthenticated user could read other
users' group memberships, create reviews under someone else's name, or delete
play sessions.

**What would go wrong if the guard were skipped?**
Controllers would have to validate tokens themselves — inconsistently, and
easy to forget on a new endpoint. The floor falls away: one unguarded route
exposes the entire resource it handles.

**Transport-agnostic checklist:**
- [ ] `extractToken` handles both `'http'` and `'ws'` context types
- [ ] `canActivate` never calls `context.switchToHttp()` directly — always
      goes through `extractToken`
- [ ] The same `validateToken` logic is used for both transports — no
      duplication
- [ ] WebSocket client sends token in `handshake.auth.token` (Socket.io
      standard, used in Phase 3)

---

## Checkpoint Questions

1. In your own words, what is the difference between a guard and a pipe?
   What does each one do, and in which order do they run?

2. If the JWT is valid but `request.user` is never set on the request
   object inside `canActivate`, what would happen when the controller tries
   to read `req.user.sub`?

3. Why is `ValidationPipe` registered globally in `main.ts` rather than
   with `@UsePipes()` on each controller? What is the risk of the
   per-controller approach?

4. What does `whitelist: true` in `ValidationPipe` protect against? Give
   a concrete example of an attack it prevents.

5. The guard calls `context.getType()` before deciding how to extract the
   token. Why is this important for Phase 3 (WebSockets)? What would break
   if you removed that branch and always called `switchToHttp()`?

---

## Rewrite Exercise

Delete `auth.guard.ts` and the DTO you build in this session and recreate
them from memory. Use this note for concepts, not for code.

Focus on: the `extractToken` helper — specifically that it checks
`context.getType()` before calling `switchToHttp()` or `switchToWs()`,
and that `canActivate` itself never mentions HTTP or WebSocket directly.
This separation is the whole point of the transport-agnostic pattern.

---

## Summary

Built: `AuthGuard` with transport-agnostic `extractToken`, global `ValidationPipe`
in `main.ts`, `CreateGroupDto` and `UpdateGroupDto` with `class-validator` decorators,
and `@UseGuards(AuthGuard)` applied to `GroupsController`.

Demonstrated understanding of: the guard/pipe execution order; why `switchToHttp()`
must not be called before checking `context.getType()`; the mass assignment
vulnerability that `whitelist` + `forbidNonWhitelisted` closes; and what the
WebSocket extension to `canActivate` will look like in Phase 3.

To revisit: the current guard still calls `switchToHttp()` in `canActivate` to
set `req.user` — this will break on WebSocket until Phase 3 adds the branching
logic described above.
