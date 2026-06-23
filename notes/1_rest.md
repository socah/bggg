# REST Fundamentals — HTTP Verbs, Status Codes, Request/Response Shape

**Phase:** 1 — Foundation
**Topic ID:** 1_rest
**Date:** 2026-06-23
**SecOps:** No

---

## What Is This?

REST (Representational State Transfer) is a set of conventions for designing
HTTP APIs. A REST API exposes **resources** — things like groups, games, users
— as URLs, and uses **HTTP verbs** to express what you want to do with them.
The response always carries a **status code** that tells the caller whether
the operation succeeded and, if not, why. REST is not a standard with a
specification — it is a style that the industry has largely converged on.

---

## Why Does It Matter for This Project?

Every NestJS controller you build in Phase 2 is a REST API. The decorator
`@Get(':id')` on a method corresponds directly to the HTTP verb and URL
pattern covered here. When you see a `201` come back from a `POST /groups`,
or a `403` from a `GET /groups/:id/members` when the user isn't a member,
you need to understand immediately what happened and why — both to build the
API correctly and to debug it. The frontend (Phase 3) will also branch on
these codes to decide what to show the user.

---

## The Decision

Chose: REST over GraphQL or tRPC
Because: simpler mental model, native HTTP caching, easier to expose to
  third parties, and NestJS has first-class REST support with minimal setup.
Alternative: GraphQL
Drawback of alternative: significant additional complexity (schema, resolvers,
  N+1 problem, tooling) that is not justified for a platform of this size and
  team. tRPC is TypeScript-only and would couple the frontend and backend
  tightly — fine for a monorepo but harder to reason about.

---

## Worked Example

This example is NOT the project code. It is a simpler, standalone version
that isolates just this concept so you can see it clearly.

### Scenario

A to-do list API. Resources: lists and items. We'll map every common
operation to a verb + URL + status code combination.

### Code / Configuration

```
── RESOURCES AND URLS ────────────────────────────────────────────────────────

A resource is a noun. URLs identify resources, not actions.

  /lists              ← the collection of all lists
  /lists/42           ← one specific list (id = 42)
  /lists/42/items     ← the collection of items belonging to list 42
  /lists/42/items/7   ← one specific item within list 42


── HTTP VERBS ────────────────────────────────────────────────────────────────

Verb      Safe?  Idempotent?  Meaning
──────────────────────────────────────────────────────────────────────────────
GET       yes    yes          Read — never changes data
POST      no     no           Create a new resource
PUT       no     yes          Replace a resource entirely
PATCH     no     no           Update part of a resource
DELETE    no     yes          Remove a resource

  Safe       = calling it never changes server state
  Idempotent = calling it N times has the same effect as calling it once
               (DELETE /lists/42 twice: second call finds nothing, still fine)


── REQUEST / RESPONSE PAIRS ─────────────────────────────────────────────────

1. List all lists
   ┌─ Request ──────────────────────────────────────────────────────────────┐
   │ GET /lists                                                              │
   │ Authorization: Bearer <jwt>                                            │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ Response (success) ───────────────────────────────────────────────────┐
   │ 200 OK                                                                  │
   │ Content-Type: application/json                                          │
   │                                                                         │
   │ [                                                                       │
   │   { "id": 1, "name": "Groceries" },                                    │
   │   { "id": 2, "name": "Weekend tasks" }                                 │
   │ ]                                                                       │
   └────────────────────────────────────────────────────────────────────────┘

2. Create a list
   ┌─ Request ──────────────────────────────────────────────────────────────┐
   │ POST /lists                                                             │
   │ Authorization: Bearer <jwt>                                            │
   │ Content-Type: application/json                                          │
   │                                                                         │
   │ { "name": "Holiday shopping" }                                          │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ Response (success) ───────────────────────────────────────────────────┐
   │ 201 Created                                                             │
   │ Location: /lists/3                   ← where the new resource lives    │
   │                                                                         │
   │ { "id": 3, "name": "Holiday shopping" }                                │
   └────────────────────────────────────────────────────────────────────────┘

3. Update part of a list (rename it)
   ┌─ Request ──────────────────────────────────────────────────────────────┐
   │ PATCH /lists/3                                                          │
   │ Authorization: Bearer <jwt>                                            │
   │ Content-Type: application/json                                          │
   │                                                                         │
   │ { "name": "Holiday shopping 2026" }   ← only the fields being changed  │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ Response (success) ───────────────────────────────────────────────────┐
   │ 200 OK                                                                  │
   │                                                                         │
   │ { "id": 3, "name": "Holiday shopping 2026" }                           │
   └────────────────────────────────────────────────────────────────────────┘

4. Delete a list
   ┌─ Request ──────────────────────────────────────────────────────────────┐
   │ DELETE /lists/3                                                         │
   │ Authorization: Bearer <jwt>                                            │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ Response (success) ───────────────────────────────────────────────────┐
   │ 204 No Content                        ← success, nothing to return     │
   └────────────────────────────────────────────────────────────────────────┘

5. Error cases
   ┌─ 400 Bad Request ───────────────────────────────────────────────────────┐
   │ POST /lists with { } (missing required "name" field)                    │
   │                                                                         │
   │ { "statusCode": 400,                                                    │
   │   "message": ["name should not be empty"],                              │
   │   "error": "Bad Request" }                                              │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ 401 Unauthorized ──────────────────────────────────────────────────────┐
   │ Any request with a missing or expired JWT                               │
   │ "I don't know who you are."                                             │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ 403 Forbidden ─────────────────────────────────────────────────────────┐
   │ GET /lists/42 when you're authenticated but not the owner               │
   │ "I know who you are. You're not allowed."                               │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ 404 Not Found ─────────────────────────────────────────────────────────┐
   │ GET /lists/999 when list 999 does not exist                             │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ 409 Conflict ──────────────────────────────────────────────────────────┐
   │ POST /lists/42/items when an item with that name already exists         │
   │ The request was valid, but the current state prevents it.               │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ 500 Internal Server Error ─────────────────────────────────────────────┐
   │ The server crashed. Never send this deliberately — it means something   │
   │ unexpected went wrong that the application did not handle.              │
   └────────────────────────────────────────────────────────────────────────┘


── QUERY PARAMS VS PATH PARAMS ──────────────────────────────────────────────

Path params identify a specific resource:
  GET /lists/42          ← 42 is part of the resource identity

Query params filter, sort, or paginate a collection:
  GET /lists?sort=name&limit=10&offset=20

Never put filtering logic in the path:
  GET /lists/sort/name   ← wrong — this implies a resource named "sort"
```

### What Is Happening Step by Step

1. **URL as resource identity** — the path `/lists/42/items/7` uniquely
   identifies item 7 inside list 42. The URL is the noun; the verb is the
   HTTP method. This separation is the core REST idea.

2. **POST returns 201, not 200** — `200 OK` means "here is what you asked
   for." `201 Created` means "I made something new." The distinction matters
   to the frontend: on a `201` it knows to redirect or refresh a list. On a
   `200` it knows to just display the result.

3. **DELETE returns 204** — there is no resource to return (it was deleted),
   so returning a body would be misleading. `204 No Content` is the honest
   response: "success, nothing to say."

4. **401 vs 403** — this distinction is frequently confused.
   - `401`: the server cannot identify the caller. The JWT is missing, expired,
     or invalid. Fix: log in again.
   - `403`: the server knows exactly who you are, but you do not have
     permission for this resource. Fix: ask an admin or use a different account.

5. **409 Conflict** — used when the request itself is valid, but it collides
   with existing state. Trying to add a duplicate group member, or redeeming
   an invite that has already been used, would both return `409`.

### What Would Break If You Changed X?

If you used `200` instead of `201` for a successful `POST /groups`:

The frontend cannot distinguish "I fetched an existing group" from "I just
created a new group." That distinction drives UX behaviour: on creation, the
frontend might redirect to the new resource's page, show a "Created!" toast,
or clear the creation form. Using `200` silently breaks that logic — no error,
just wrong behaviour.

---

## Now Apply It

Every NestJS controller maps directly onto this:

```typescript
@Controller('groups')         // base path: /groups
export class GroupsController {

  @Get()                      // GET /groups        → 200
  findAll() {}

  @Get(':id')                 // GET /groups/42     → 200 or 404
  findOne(@Param('id') id: string) {}

  @Post()                     // POST /groups       → 201
  @HttpCode(201)
  create(@Body() dto: CreateGroupDto) {}

  @Patch(':id')               // PATCH /groups/42   → 200 or 404
  update(@Param('id') id: string, @Body() dto: UpdateGroupDto) {}

  @Delete(':id')              // DELETE /groups/42  → 204 or 404
  @HttpCode(204)
  remove(@Param('id') id: string) {}
}
```

Files to look at after Phase 2 generates them:
- `apps/api/src/groups/groups.controller.ts` — verb decorators and status codes
- `apps/api/src/groups/dto/create-group.dto.ts` — shape of the POST request body
- `apps/api/src/groups/dto/update-group.dto.ts` — shape of the PATCH request body

---

## Checkpoint Questions

1. What is the difference between `401` and `403`? Give a concrete example
   from this platform for each.

2. A user sends `POST /groups` with a valid body but the group name already
   exists. What status code should the API return, and why not `400`?

3. Why does `PATCH` exist alongside `PUT`? When would you use one over the
   other for updating a group's description?

4. `DELETE /groups/42` is called twice in quick succession. The second call
   finds no group with id 42. What status code should it return — `404` or
   `204` — and why does it matter?

5. A request comes in as `GET /groups?member=true&sort=name`. Where in a
   NestJS controller would you extract `member` and `sort`, and what decorator
   would you use?

---

## Summary

Built: `apps/api/http/groups.http` — full REST contract for the groups resource covering all CRUD endpoints for groups, members, and group games, with expected status codes documented per request.
Demonstrated understanding of: 409 vs 400 distinction (valid request, conflicting state); 204 No Content semantics for deletes; correct status code (400) for invalid enum input. Identified the validation pipe as the correct primary catch layer, with the database CHECK constraint as a backstop — understanding why relying on the DB as the primary gate produces unmapped 500 errors.
To revisit: none — all checkpoint answers were correct, and the layer nuance was understood after a single clarification.
