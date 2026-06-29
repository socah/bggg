# Testing in NestJS — Jest Unit Tests, E2E Tests, Mocking Providers

**Phase:** 2 — Backend Core
**Topic ID:** 2_testing
**Date:** 2026-06-26
**SecOps:** No

---

## What Is This?

Testing is the practice of writing code that automatically checks whether your
application code behaves correctly. **Unit tests** run a single class in
isolation — all its dependencies are replaced with fakes (mocks) so the test
only exercises the one thing it is claiming to verify. **End-to-end (e2e)
tests** boot the whole application and send real HTTP requests through it,
verifying that all the layers work together correctly.

Jest is the test runner: it finds `.spec.ts` files, executes them, and reports
which assertions passed or failed. `@nestjs/testing` provides a
`Test.createTestingModule()` helper that builds a stripped-down NestJS
container — no HTTP server, no real database — so you can inject mocks instead
of real providers.

---

## Why Does It Matter for This Project?

Our `GroupsService` talks to PostgreSQL via TypeORM, and our
`GroupsController` enforces auth via `AuthGuard`. Without mocking, every test
would need a live database and a valid JWT — making tests slow, fragile, and
impossible to run in CI without a running Postgres container. Mocking lets us
verify the service and controller logic completely offline, in milliseconds.

---

## The Decision

Chose: Jest + `@nestjs/testing` with manual provider mocks (plain `jest.fn()`
objects).

Because: `@nestjs/testing` integrates with NestJS's dependency injection so
we can swap real providers for fakes without changing any production code.
`jest.fn()` mocks are simple, explicit, and show exactly what each test
expects — there is no hidden magic.

Alternative: Integration tests against a real test database (e.g. a Docker
Postgres spun up by Jest globalSetup).

Drawback of alternative: Much slower (seconds per test suite vs. milliseconds),
requires Docker in CI, and tests two things at once — your logic AND your SQL
— making failures harder to diagnose. We keep DB-level correctness for e2e
only.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

A `CalculatorService` that adds two numbers. We want to test it without
starting any HTTP server. Then a `GreetingController` that calls
`GreetingService` — we want to test the controller without the real service.

### Code / Configuration

```typescript
// calculator.service.ts (production code)
import { Injectable } from '@nestjs/common';

@Injectable()
export class CalculatorService {
  add(a: number, b: number): number {
    return a + b;
  }
}

// ---------------------------------------------------------------

// calculator.service.spec.ts (unit test)
import { Test, TestingModule } from '@nestjs/testing';
import { CalculatorService } from './calculator.service';

describe('CalculatorService', () => {
  let service: CalculatorService;

  // beforeEach runs before EVERY test in this describe block.
  // It creates a fresh module + fresh service instance each time,
  // so one test cannot pollute another.
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // providers: list every class this module needs.
      // No controllers, no imports — just what is needed for this test.
      providers: [CalculatorService],
    }).compile();

    // .get<T>() retrieves the instance NestJS created for us.
    service = module.get<CalculatorService>(CalculatorService);
  });

  // it() is one test case. The string is the test name shown in output.
  it('should add two positive numbers', () => {
    // arrange: set up inputs (none needed here)
    // act: call the code under test
    const result = service.add(2, 3);
    // assert: verify the output
    expect(result).toBe(5);
  });

  it('should handle negative numbers', () => {
    expect(service.add(-1, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------

// greeting.service.ts (production code — the dependency we want to MOCK)
@Injectable()
export class GreetingService {
  greet(name: string): string {
    return `Hello, ${name}`;
  }
}

// greeting.controller.ts (production code — the thing under test)
@Controller('greet')
export class GreetingController {
  constructor(private readonly greetingService: GreetingService) {}

  @Get(':name')
  greet(@Param('name') name: string): string {
    return this.greetingService.greet(name);
  }
}

// ---------------------------------------------------------------

// greeting.controller.spec.ts (unit test with a mock)
import { Test, TestingModule } from '@nestjs/testing';
import { GreetingController } from './greeting.controller';
import { GreetingService } from './greeting.service';

describe('GreetingController', () => {
  let controller: GreetingController;

  // This is the mock: a plain object whose methods are jest.fn() spies.
  // jest.fn() creates a function that records every call made to it
  // and can be configured to return specific values.
  const mockGreetingService = {
    greet: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GreetingController],
      providers: [
        {
          // provide: tells NestJS which token to override.
          provide: GreetingService,
          // useValue: substitutes the real class with our plain object.
          // NestJS injects this object wherever GreetingService is requested.
          useValue: mockGreetingService,
        },
      ],
    }).compile();

    controller = module.get<GreetingController>(GreetingController);
  });

  // afterEach resets all mocks so one test's return values don't leak into
  // the next test.
  afterEach(() => jest.clearAllMocks());

  it('should call greetingService.greet with the name param', () => {
    // Configure the mock to return a specific value for THIS test.
    mockGreetingService.greet.mockReturnValue('Hello, Alice');

    const result = controller.greet('Alice');

    // Verify the controller passed the right argument to the service.
    expect(mockGreetingService.greet).toHaveBeenCalledWith('Alice');
    // Verify the controller returns whatever the service returned.
    expect(result).toBe('Hello, Alice');
  });
});
```

### What Is Happening Step by Step

1. **`Test.createTestingModule({ providers: [...] })`** — builds a NestJS
   module in memory. No HTTP server starts. No real database connects. This
   is the core of NestJS testing.

2. **`.compile()`** — finalises the module: runs all decorators, resolves
   dependency injection. Always awaited because DI setup can be async (e.g.
   async providers).

3. **`module.get<T>(Token)`** — retrieves the singleton instance NestJS created.
   You use this to get the class under test.

4. **`provide: GreetingService, useValue: mockGreetingService`** — this is
   the mock swap. Anywhere the real `GreetingService` would be injected,
   NestJS now injects `mockGreetingService` instead. The production code
   (`GreetingController`) has no idea — it just calls `this.greetingService.greet()`,
   which now calls the `jest.fn()`.

5. **`jest.fn()`** — creates a no-op function that records calls. You configure
   its return value per-test with `.mockReturnValue(...)` or
   `.mockResolvedValue(...)` (for async).

6. **`expect(...).toHaveBeenCalledWith(...)`** — verifies the code under test
   called the mock with the right arguments. This is how you check that the
   controller correctly forwards the route param to the service.

7. **`afterEach(() => jest.clearAllMocks())`** — resets call counts and
   configured return values. Without this, a `.mockReturnValue('Hello, Alice')`
   from test 1 would still be active in test 2.

### What Would Break If You Changed X?

If you removed `afterEach(() => jest.clearAllMocks())` and wrote two tests —
one configuring `greet.mockReturnValue('Hello, Alice')` and one that did NOT
configure a return value — the second test would still get `'Hello, Alice'`
from the first test's configuration. The second test would appear to pass even
if the controller's logic were completely wrong. Mock isolation is not cosmetic:
it prevents false positives.

---

## E2E Tests — How They Differ

Unit tests call class methods directly. E2E tests send real HTTP requests.
That difference is what makes them complementary rather than redundant.

### What e2e tests verify that unit tests cannot

When you call `controller.findOne(1)` in a unit test, you are **bypassing
NestJS's HTTP machinery entirely**. None of these run:

- **`ParseIntPipe`** — the string `"abc"` would just be passed as-is to the
  controller method. The unit test would never catch a misconfigured pipe.
- **`@HttpCode(201)`** — the unit test calls the method and checks its return
  value, but has no concept of HTTP status codes.
- **Route matching** — there is no HTTP server, so there is no way to verify
  that `POST /groups` reaches `create()` and not some other handler.
- **Request serialization** — the unit test works with in-memory objects. An
  e2e test catches issues like circular references breaking JSON serialization.

### The `createNestApplication()` lifecycle

```typescript
// 1. Build the module (same as unit tests — no HTTP server yet)
const module = await Test.createTestingModule({ ... })
  .overrideGuard(AuthGuard).useValue({ canActivate: () => true })
  .compile();

// 2. Wrap it in a full NestJS application — this wires up the HTTP adapter,
//    global pipes, exception filters, etc.
app = module.createNestApplication();

// 3. Apply any global middleware that production uses — without this, the
//    e2e test does not reflect the real app's behaviour.
app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

// 4. Start the HTTP server. No port is bound — supertest communicates via
//    the underlying http.Server object directly.
await app.init();

// 5. After all tests, close the server to free resources. Without this,
//    Jest hangs because the server is still listening.
await app.close();
```

### `beforeAll` vs `beforeEach`

Unit tests use `beforeEach` to create a fresh module before every test —
this is cheap because no server starts. E2E tests use `beforeAll` to boot
the app **once** for the whole suite. Booting NestJS (compiling decorators,
resolving DI) takes ~100–300ms. Doing it before every test would make an
e2e suite of 20 tests take 4–6 seconds just on setup.

The trade-off: with `beforeAll`, test state can leak between tests if mocks
are not reset. That is why `afterEach(() => jest.clearAllMocks())` remains
important in e2e tests too.

### How `supertest` sends requests

```typescript
import request from 'supertest';

// app.getHttpServer() returns the raw Node.js http.Server instance.
// supertest wraps it and gives you a chainable request builder.
await request(app.getHttpServer())
  .get('/groups/abc')   // send GET /groups/abc
  .expect(400);         // assert HTTP status code
```

No network port is opened. `supertest` calls the server's `listen()` method
on a random ephemeral port internally, sends the request, then closes it.
This makes e2e tests fast and safe to run in parallel.

### The `AppModule` trap

Importing `AppModule` in an e2e test boots the entire application — including
`TypeOrmModule.forRoot()`, which immediately tries to connect to Postgres.
Even if you have mocked `GroupsService`, the TypeORM module initialises
before your overrides take effect, causing a connection timeout.

**The fix:** do not import `AppModule`. Register only the controllers you are
testing, plus their mocked providers. The HTTP layer (pipes, guards, routing)
comes from `createNestApplication()`, not from the module graph.

```typescript
// Wrong — triggers TypeORM connection
Test.createTestingModule({ imports: [AppModule] })

// Right — only what we need; no database involved
Test.createTestingModule({
  controllers: [GroupsController],
  providers: [{ provide: GroupsService, useValue: mockGroupsService }],
})
```

---

## Why You Need All Three Test Types

Each type catches a different class of bug. They are not redundant — they
are complementary.

| Test type | Mocks | What it verifies | What it CANNOT catch |
|---|---|---|---|
| Service spec | `Repository<Group>` | Business logic: 404 path, correct SQL args, data transformation | HTTP routing, pipes, status codes |
| Controller spec | `GroupsService` | Delegation: does the controller call the right service method with the right args? | `ParseIntPipe` failures, `@HttpCode` values, route matching |
| E2E spec | `GroupsService` | HTTP wiring: routes, pipes, status codes, serialization | Whether the service's 404 logic is correct |

**Example of a bug each layer catches and the others miss:**

- **Only the service test catches:** `findOne()` returns the group instead of
  throwing `NotFoundException` when `findOneBy` returns `null`. The controller
  test would never trigger the 404 branch; the e2e test would get a 200 when
  it expected a 404 — but you'd still know it was a service bug.

- **Only the controller test catches:** The controller calls
  `this.groupsService.findAll()` but accidentally passes `id` as an argument
  (`findAll(id)` instead of `findOne(id)`). The service test doesn't involve
  the controller at all.

- **Only the e2e test catches:** `@HttpCode(201)` is missing from `create()`,
  so `POST /groups` returns 200 instead of 201. Unit tests call the method
  directly and check the return value — they have no concept of status codes.
  Another example: `ParseIntPipe` is accidentally removed from `@Param`, so
  `GET /groups/abc` reaches the service with the string `"abc"` instead of
  returning 400.

The practical rule: **fix a failing service test first** — it has the smallest
surface area, so a failure almost certainly points to the exact method. A
failing e2e test could be caused by the service, the controller, a pipe, or
the routing — start by running the unit tests to narrow it down.

---

## Now Apply It

We will write three test files for the board game platform:

1. **`apps/api/src/groups/groups.service.spec.ts`** — unit test for
   `GroupsService`. The real `Repository<Group>` is replaced by a mock object
   with `jest.fn()` spies for `.find()`, `.findOneBy()`, `.create()`,
   `.save()`, and `.remove()`. This lets us test the service's 404 logic and
   data flow without a database.

2. **`apps/api/src/groups/groups.controller.spec.ts`** — unit test for
   `GroupsController`. The real `GroupsService` is replaced by a mock. The
   real `AuthGuard` is overridden so it always allows the request — otherwise
   every test would fail with a 401 before it even reaches the controller.

3. **`apps/api/test/groups.e2e-spec.ts`** — e2e test that boots the full
   NestJS app (still with a mocked service — no real DB) and fires real HTTP
   requests using `supertest`. This confirms the HTTP wiring (routes,
   status codes, pipes) all the way through.

Files to look at after this note:
- [apps/api/src/groups/groups.service.ts](../apps/api/src/groups/groups.service.ts) — the class under test in the service spec
- [apps/api/src/groups/groups.controller.ts](../apps/api/src/groups/groups.controller.ts) — the class under test in the controller spec
- [apps/api/src/auth/auth.guard.ts](../apps/api/src/auth/auth.guard.ts) — the guard we will override in tests

---

## Checkpoint Questions

1. What is the difference between a unit test and an e2e test, and when would
   you choose one over the other?
2. Why do we replace `Repository<Group>` with a mock in the service unit test
   rather than using a real database?
3. If a test for `findOne(99)` is supposed to verify the 404 path, what would
   you configure the mock repository to return, and why?
4. What does `jest.clearAllMocks()` do, and what specific bug does skipping it
   cause?
5. In the controller spec, why do we override `AuthGuard` with a guard that
   always returns `true`? What would happen if we didn't?

---

## Summary

Built: `groups.service.spec.ts` (unit tests mocking `Repository<Group>`),
`groups.controller.spec.ts` (unit tests mocking `GroupsService` + `AuthGuard`
override), and `test/groups.e2e-spec.ts` (6 e2e tests via supertest against a
real HTTP server, no database). Also fixed `group.entity.ts` definite assignment
assertions (`!`) and wired `"types": ["jest", "node"]` into `tsconfig.json`.

Demonstrated understanding of: mock swap direction (service spec mocks the
repository, controller spec mocks the service); why `getRepositoryToken(Group)`
is the correct DI token; why `AuthGuard` must be overridden in tests; the
false-positive bug from skipping `clearAllMocks()`.

To revisit: The `AppModule` vs direct controller registration trade-off in e2e
tests — encountered when `AppModule` triggered a real DB connection. Worth
revisiting when true integration e2e tests (with a real test database) are added.
