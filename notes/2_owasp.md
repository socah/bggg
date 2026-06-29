# OWASP Top 10 Applied — Broken Access Control & IDOR in the Group API

**Phase:** 2 — Backend Core
**Topic ID:** 2_owasp
**Date:** 2026-06-29
**SecOps:** Yes

---

## What Is This?

The OWASP Top 10 is a ranked list of the most common web application security
risks, published by the Open Web Application Security Project. **Broken Access
Control (A01)** is ranked #1 — meaning it is the most frequently exploited
class of vulnerability found in real-world apps. It covers any situation where
a user can act on a resource they should not be allowed to touch. A specific
subclass of this is **Insecure Direct Object Reference (IDOR)**: when an API
accepts a resource identifier in the URL and returns the resource without
checking whether the requesting user has permission to see it.

---

## Why Does It Matter for This Project?

Our Groups API is currently broken in exactly the A01 way: any authenticated
user can read, update, or delete *any* group by guessing its ID — and because
the IDs are sequential integers (1, 2, 3…), guessing them is trivial. We
also don't enforce CORS, which means a malicious page on another domain could
make credentialed requests to the API on behalf of a logged-in user.

---

## The Decision

Two separate decisions are made in this topic:

**Decision 1: UUID primary keys instead of sequential integers**
- Chose: `@PrimaryGeneratedColumn('uuid')` — PostgreSQL generates a random
  128-bit ID for every row
- Because: Sequential integers make enumeration trivial (`/groups/1`,
  `/groups/2`…). UUIDs don't prevent access control bugs, but they remove
  the "easy guess" attack surface and are a standard defence-in-depth measure.
- Alternative: Keep sequential integers, rely entirely on access control checks
- Drawback of alternative: A single missed auth check becomes an enumeration
  vulnerability. UUIDs give a second line of defence.

**Decision 2: Ownership checks in the service layer, not the controller**
- Chose: Service methods accept `requestingUserId` and throw `ForbiddenException`
  if the requester does not own the resource
- Because: Controllers are thin — they route. Business rules (including "can
  this user do this?") belong in the service. Putting the check in the
  controller would mean every future caller of the service would need to
  remember to do the check themselves.
- Alternative: Middleware or a dedicated Policy/Ability guard (e.g. CASL)
- Drawback of alternative: CASL is the right long-term answer for complex
  role hierarchies, but is heavyweight for a project at this stage. We'll
  add it if group roles become complex (admin/member/observer).

---

## Worked Example

This example is NOT the project code. It is a minimal standalone API that
demonstrates the three-stage fix: IDOR → UUID → ownership check.

### Scenario

A note-taking API. Each note belongs to a user. We'll show the broken
version, then fix it in two steps.

### Code / Configuration

```typescript
// --- BROKEN VERSION ---
// Any authenticated user can read, update, or delete any note by ID.

// note.entity.ts (broken)
@Entity('notes')
class Note {
  @PrimaryGeneratedColumn()   // sequential: 1, 2, 3...
  id: number;

  @Column()
  content: string;

  @Column({ name: 'owner_id' })
  ownerId: string;             // tracks who owns it, but nobody checks it
}

// notes.service.ts (broken)
async findOne(id: number): Promise<Note> {
  const note = await this.noteRepo.findOneBy({ id });
  if (!note) throw new NotFoundException();
  return note;  // returned to whoever asked — no ownership check
}

async remove(id: number): Promise<void> {
  const note = await this.findOne(id);
  await this.noteRepo.remove(note);  // any authenticated user can delete any note
}

// notes.controller.ts (broken)
@Get(':id')
findOne(@Param('id', ParseIntPipe) id: number) {
  return this.notesService.findOne(id);  // req.user is never used
}
```

```typescript
// --- FIXED VERSION ---

// note.entity.ts (fixed)
@Entity('notes')
class Note {
  @PrimaryGeneratedColumn('uuid')  // Step 1: random UUID — not guessable
  id: string;

  @Column()
  content: string;

  @Column({ name: 'owner_id' })
  ownerId: string;
}

// notes.service.ts (fixed)
async findOne(id: string, requestingUserId: string): Promise<Note> {
  const note = await this.noteRepo.findOneBy({ id });
  if (!note) throw new NotFoundException();

  // Step 2: ownership check — the critical line.
  // Without this, UUIDs make guessing harder but don't make it impossible
  // (e.g. an ID leaked in a log). The check is the real protection.
  if (note.ownerId !== requestingUserId) {
    throw new ForbiddenException('You do not own this note');
  }

  return note;
}

async remove(id: string, requestingUserId: string): Promise<void> {
  // findOne already checks ownership — if it returns, we're authorised.
  const note = await this.findOne(id, requestingUserId);
  await this.noteRepo.remove(note);
}

// notes.controller.ts (fixed)
@Get(':id')
findOne(
  @Param('id', ParseUUIDPipe) id: string,  // ParseUUIDPipe validates UUID format
  @Request() req,
) {
  // req.user.sub is the authenticated user's ID, set by the AuthGuard.
  return this.notesService.findOne(id, req.user.sub);
}
```

### What Is Happening Step by Step

1. **`@PrimaryGeneratedColumn('uuid')`** — PostgreSQL's `gen_random_uuid()`
   generates a random 128-bit value. An attacker trying `/notes/2` gets a 404
   because `2` is not a valid UUID. Even if they know UUIDs exist, the search
   space is 2^122 — practically unenumerable.

2. **`requestingUserId` parameter on service methods** — The service now
   *requires* the caller to say who is asking. The controller reads this from
   `req.user.sub` (set by the auth guard). The service is the authority on
   whether the user is allowed to proceed.

3. **`if (note.ownerId !== requestingUserId)` → `ForbiddenException`** —
   This is the ownership check. `ForbiddenException` maps to HTTP 403 (you
   are authenticated, but not authorised). A `NotFoundException` (404) would
   also be acceptable — it leaks less information about whether the resource
   exists — but 403 is clearer for debugging.

4. **`ParseUUIDPipe`** — Validates that the `:id` param is a well-formed UUID
   before it reaches the service. Prevents garbage inputs like `SELECT * FROM`
   from ever touching the database.

### What Would Break If You Changed X?

If you removed the `if (note.ownerId !== requestingUserId)` check from
`findOne`, but kept it in `remove` — a user could still read any note by
hitting `GET /notes/:id` with a guessed UUID. Access control checks must be
applied *per-operation*, not assumed to be covered by another operation.

---

## Now Apply It

We have three problems to fix in the Groups API:

**Problem 1 — Sequential integer IDs (IDOR)**
The `Group` entity uses `@PrimaryGeneratedColumn()` which produces 1, 2, 3…

- [apps/api/src/groups/group.entity.ts](apps/api/src/groups/group.entity.ts) — change `@PrimaryGeneratedColumn()` to `@PrimaryGeneratedColumn('uuid')` and `id: number` to `id: string`
- [apps/api/src/groups/groups.controller.ts](apps/api/src/groups/groups.controller.ts) — replace `ParseIntPipe` with `ParseUUIDPipe`
- [apps/api/src/groups/groups.service.ts](apps/api/src/groups/groups.service.ts) — all `id: number` params become `id: string`

**Problem 2 — No ownership tracking**
The `Group` entity has no column recording who created it, so we can't check
ownership at all.

- [apps/api/src/groups/group.entity.ts](apps/api/src/groups/group.entity.ts) — add a `ownerId` column (stores the JWT `sub` claim)
- [apps/api/src/groups/groups.service.ts](apps/api/src/groups/groups.service.ts) — `create()` must receive and store the owner's ID
- [apps/api/src/groups/groups.controller.ts](apps/api/src/groups/groups.controller.ts) — `create()` must pass `req.user.sub` through

**Problem 3 — No authorisation on mutating operations**
`update()` and `remove()` allow any authenticated user to change any group.
`findAll()` exposes every group to every user — it should only return groups
the requester is a member of (for now: groups they own).

- [apps/api/src/groups/groups.service.ts](apps/api/src/groups/groups.service.ts) — all service methods receive `requestingUserId` and check ownership

**Problem 4 — No CORS configuration**
`main.ts` calls `app.listen()` with no `app.enableCors()`. NestJS disables
CORS by default, which is safe — but we need to enable it explicitly with a
specific origin so the frontend can call the API, while other origins cannot.

- [apps/api/src/main.ts](apps/api/src/main.ts) — add `app.enableCors({ origin: process.env.CORS_ORIGIN })`

---

## SecOps Notes

**Security property upheld:** Principle of least privilege for data access.
A user should be able to see and modify only the resources they are entitled
to — not the entire dataset.

**Attack mitigated:** Horizontal privilege escalation. This is where a user
manipulates an identifier (an ID, a UUID, a slug) to access another user's
data at the same privilege level. It is distinct from vertical escalation
(becoming an admin).

**What goes wrong if this step is skipped:**
- IDOR with integer IDs: An attacker writes a script to request
  `GET /groups/1` through `GET /groups/9999`. They harvest all group names,
  membership data, and any other fields — without ever having to be a member.
- No ownership check: An authenticated attacker can `DELETE /groups/<uuid>`
  for any UUID they discover (from a URL, a log, a shared link). The group is
  gone and there is no record of who deleted it.
- Wildcard CORS: A malicious web page at `evil.com` can make authenticated
  requests to `api.yourdomain.com` using the victim's browser cookies/tokens.
  This is a CSRF-adjacent attack enabled by overly permissive CORS.

**OWASP checklist items addressed here:**
- [x] All primary keys are UUIDs in public-facing routes
- [x] Every mutating endpoint has an explicit ownership check
- [x] `findAll` scoped to resources the requester has access to
- [x] CORS configured to specific allowed origin (done in main.ts)
- [ ] Swagger disabled in production (not added yet — no Swagger in codebase)

---

**A03 — Injection (not a code change, but worth knowing)**

SQL injection is the classic example: an attacker sends `'; DROP TABLE groups; --`
as an ID and the database executes it. TypeORM prevents this automatically by
using parameterised queries for every `.find()`, `.findOneBy()`, and `.save()`
call — the value is never interpolated into the SQL string directly.

The risk re-emerges if anyone uses `this.groupRepository.query()` with string
concatenation rather than the parameter array. That raw escape hatch bypasses
TypeORM's protection entirely. Convention: never use `.query()` with
user-supplied values interpolated as strings.

---

**A10 — Server-Side Request Forgery (relevant to the BGG integration)**

SSRF is when an attacker causes the *server* to make an outbound HTTP request
to a URL they control — often to reach internal services (e.g. `http://169.254.169.254/`
is the AWS metadata endpoint, accessible from the server but not the browser).

In `bgg.service.ts`, the API URL (`https://boardgamegeek.com/xmlapi2/...`) is
hardcoded. That is safe. The risk would appear if the URL were ever built from
user input — e.g. `GET /bgg/proxy?url=<user-supplied>`. If that were added
without validation, an attacker could point it at internal infrastructure.

Guard: never accept a full URL from user input. Accept only an identifier
(a BGG game ID) and construct the URL entirely in server code.

---

## Checkpoint Questions

1. What is the difference between *authentication* and *authorisation*?
   Which one does the `AuthGuard` handle, and which one are we adding now?
2. Why are sequential integer IDs a problem even if every endpoint has an
   ownership check? What does a UUID buy you in defence-in-depth terms?
3. If you removed `requestingUserId` from the `update()` service method but
   left it on `remove()`, what specific attack becomes possible?
4. `ParseUUIDPipe` rejects non-UUID strings with a 400. Why is this useful
   from a security perspective, not just a validation perspective?
5. We throw `ForbiddenException` (403) rather than `NotFoundException` (404)
   when a user requests a group they don't own. What are the security
   trade-offs of each choice?

---

## Summary

Built: UUID primary keys on the Group entity, an `ownerId` column, ownership
checks on all service methods, scoped `findAll`, and explicit CORS configuration.

Demonstrated understanding of: the distinction between authentication and
authorisation; why UUIDs reduce IDOR risk; why `ownerId` must not appear in
DTOs (server-set fields are not the client's to declare); the two-step
404→403 pattern and why separating those cases matters for future audit
logging; and — critically — that access rules are per-operation: membership
grants read access but not delete access, which stays owner-only.

To revisit: the hybrid single-query + second-query-for-logging approach
proposed during this session — implement it properly in `2_audit_logging`
using `AuditService` rather than inline queries in the service layer.
