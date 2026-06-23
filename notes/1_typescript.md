# TypeScript — Types, Interfaces, Generics, Decorators

**Phase:** 1 — Foundation
**Topic ID:** 1_typescript
**Date:** 2026-06-22
**SecOps:** No

---

## What Is This?

TypeScript is JavaScript with a type system layered on top. You write `.ts`
files that get compiled to plain `.js` before running. The compiler checks
your code before it executes, catching whole classes of mistakes — wrong
argument types, missing properties, misspelled method names — that in plain
JavaScript you would only discover at runtime (or not at all).

The four features we care about most here are:
- **Types and interfaces** — describe the shape of data
- **Generics** — write one piece of code that works for many types safely
- **Decorators** — attach metadata or behaviour to a class or its members
  using `@Something` syntax

---

## Why Does It Matter for This Project?

NestJS and TypeORM are **decorator-first frameworks** — you declare a module
with `@Module({})`, an entity with `@Entity()`, a column with `@Column()`.
Without understanding how decorators work you will not be able to read a single
NestJS file. Generics are how NestJS services are typed (e.g. `Repository<Game>`
gives you a fully typed handle to the `games` table), and interfaces define
the contracts between modules — e.g. the shape of a decoded JWT that every
auth guard will receive.

---

## The Decision

Chose: TypeScript strict mode (`"strict": true` in `tsconfig.json`)
Because: strict mode enables `strictNullChecks` and `noImplicitAny`, which
prevent the two most common categories of runtime error — accessing properties
on `undefined` and accidentally passing the wrong type.
Alternative: loose mode (omit strict) or plain JavaScript
Drawback of alternative: NestJS and TypeORM decorators rely on emitted type
metadata (`emitDecoratorMetadata`) which only works with TypeScript anyway,
so plain JS is out. Loose mode lets `null` and `any` slip through silently —
you get the compile step but lose most of its value.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

A small library system: you want to describe a book, write a generic function
that finds an item in a list by ID, and use a decorator to log every call to
a method.

### Code / Configuration

```typescript
// ── 1. INTERFACE ──────────────────────────────────────────────────────────
// An interface describes the *shape* of an object. No runtime code is emitted.
// It is purely a compile-time contract.
interface Book {
  id: number;
  title: string;
  author: string;
  publishedYear: number;
}

// ── 2. TYPE ALIAS ─────────────────────────────────────────────────────────
// A type alias can describe anything: primitives, unions, intersections.
// Use `type` for unions/intersections; prefer `interface` for object shapes.
type BookStatus = 'available' | 'checked-out' | 'reserved';

// ── 3. GENERIC FUNCTION ───────────────────────────────────────────────────
// <T extends { id: number }> means: "T can be any type, as long as it has
// an `id` property of type number". This lets one function work for Book,
// Member, Loan, etc. — without duplicating code and without losing type safety.
function findById<T extends { id: number }>(items: T[], id: number): T | undefined {
  return items.find(item => item.id === id);
}

const books: Book[] = [
  { id: 1, title: 'Pandemic', author: 'Matt Leacock', publishedYear: 2008 },
  { id: 2, title: 'Wingspan', author: 'Elizabeth Hargrave', publishedYear: 2019 },
];

const found = findById(books, 1);
// TypeScript knows `found` is `Book | undefined` — it will enforce a null
// check before you can access found.title.
if (found) {
  console.log(found.title); // ✓ safe
}

// ── 4. DECORATOR ──────────────────────────────────────────────────────────
// A decorator is a function that receives a class (or method/property) and
// can inspect or modify it. The `@Log` below is a *method decorator*.
//
// To use decorators you need in tsconfig.json:
//   "experimentalDecorators": true
//   "emitDecoratorMetadata": true   ← needed by NestJS/TypeORM
//
// A method decorator receives: (target, propertyKey, descriptor)
//   target      — the class prototype
//   propertyKey — the name of the method as a string
//   descriptor  — an object containing the actual function under .value
function Log(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value; // save the original method

  // Replace the method with a wrapper that logs before/after
  descriptor.value = function (...args: any[]) {
    console.log(`[LOG] Calling ${propertyKey} with`, args);
    const result = original.apply(this, args); // call the original
    console.log(`[LOG] ${propertyKey} returned`, result);
    return result;
  };
}

class LibraryService {
  @Log  // ← attaches the decorator to this method
  checkOut(bookId: number, memberId: number): BookStatus {
    // In reality this would update a database; here we just return a value.
    return 'checked-out';
  }
}

const service = new LibraryService();
service.checkOut(1, 42);
// Console output:
//   [LOG] Calling checkOut with [1, 42]
//   [LOG] checkOut returned checked-out
```

### What Is Happening Step by Step

1. **Interface `Book`** — defines that any object called a `Book` must have
   exactly those four properties with those types. If you try to create a
   `Book` without `author`, the compiler errors immediately.

2. **Type alias `BookStatus`** — a *union type*: the only valid values are
   those three strings. Assigning `'lost'` to a `BookStatus` variable is a
   compile error.

3. **Generic `findById<T>`** — the `<T extends { id: number }>` constraint
   says "I'll accept any list, as long as each item has an `id` field". When
   you call `findById(books, 1)`, TypeScript infers `T = Book` automatically.
   The return type becomes `Book | undefined` — no guessing, no casting.

4. **`@Log` decorator** — the decorator function runs once at class-definition
   time (not each method call). It replaces `descriptor.value` with a new
   function that wraps the original. Every subsequent call to `checkOut` goes
   through the wrapper. This is how NestJS implements `@UseGuards()`,
   `@UsePipes()`, and how TypeORM implements `@Column()`.

### What Would Break If You Changed X?

If you removed `<T extends { id: number }>` and used just `<T>`:

```typescript
function findById<T>(items: T[], id: number): T | undefined {
  return items.find(item => item.id === id); // ← ERROR
  //                        ^^^^^ Property 'id' does not exist on type 'T'
}
```

TypeScript no longer knows that items have an `id` field, so accessing
`item.id` is an error. The constraint is what makes the generic safe rather
than just `any` in disguise.

---

## Now Apply It

These TypeScript features appear throughout the entire backend. As you build
each feature you will see:

- **Interfaces** — `apps/backend/src/auth/jwt-payload.interface.ts` — the
  shape of a decoded Keycloak JWT that every guard will type-check against
- **Generics** — `apps/backend/src/games/games.service.ts` — TypeORM's
  `Repository<Game>` gives a fully-typed repository injected via DI
- **Decorators** — every NestJS file: `@Module()`, `@Controller()`,
  `@Injectable()`, `@Get()`, `@Post()`, `@Body()`, `@Param()`, etc.
- **Type aliases / unions** — `apps/backend/src/groups/group-role.type.ts` —
  `type GroupRole = 'owner' | 'admin' | 'member'`

None of these files exist yet — you will create them in Phase 2. This note
gives you the foundation to understand every decorator and generic you will
encounter when you get there.

---

## Checkpoint Questions

1. What is the difference between a `type` alias and an `interface` in
   TypeScript, and when would you prefer one over the other?

2. If `findById<T extends { id: number }>(items: T[], id: number)` returns
   `T | undefined`, what does TypeScript force you to do before you can access
   a property on the result — and why?

3. A decorator runs at class-definition time, not at call time. What does that
   mean in practice for a `@Log` decorator on a method?

4. NestJS uses `emitDecoratorMetadata: true` in `tsconfig.json`. What does
   this setting emit, and what does NestJS use it for?

5. `@Injectable()` in NestJS is just a decorator. Based on what you know
   about how decorators work, what do you think it might be doing under the
   hood?

---

## Summary

Built: root `tsconfig.json` (shared monorepo base) and `apps/api/tsconfig.json` / `tsconfig.build.json` (NestJS-specific extension with paths and test exclusion).
Demonstrated understanding of: how `emitDecoratorMetadata` works at runtime — TypeScript erases types during compilation, so without this flag NestJS cannot resolve constructor argument types for dependency injection, causing silent `undefined` injection failures.
To revisit: none identified — decorator mechanics and the metadata/DI link were understood cleanly.
