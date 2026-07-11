# Invite System — Signed Tokens, Expiry, Group Roles, QR Codes

**Phase:** 3 — Frontend, Auth & Real-Time
**Topic ID:** `3_invite_system`
**Date:** 2026-07-11
**SecOps:** Yes

---

## What Is This?

An invite system lets someone who already belongs to a group grant a *new*
person access to it, without that new person needing an account or a role
assigned by hand in advance. The core mechanic is a **single-use secret** —
a token embedded in a shareable link (and, here, a QR code) that proves
"whoever holds this was given permission by someone with the authority to
invite." The server's job is to make that secret hard to guess, easy to
revoke, and impossible to use twice.

---

## Why Does It Matter for This Project?

Right now `groups.service.ts` only knows one relationship: a group has
exactly one `ownerId`. There is no way for the owner to bring in the rest of
their board game group short of you, the developer, manually inserting rows.
This topic introduces `group_members` (already sketched in `db/schema.sql`
but never implemented) so a group can have many people with different roles,
and builds the mechanism — invites — that populates that table in practice.
The QR code matters specifically for this project's use case: board game
night is an in-person event, and "scan this to join our group" is a much
lower-friction flow than typing a URL on a phone.

There's a second, bigger reason this matters: this app is meant to be
**publicly reachable but only grow through a friends network** — not open
to anyone who finds the URL. That requirement turns the invite system from
"a nice-to-have for organizing an existing group" into **the only door into
the platform at all** — see Decision 4 below.

---

## The Decision

This topic actually bundles three separate decisions. Each has a real
alternative that looked reasonable, so each is worth walking through.

### Decision 1 — Token format: opaque random token, hashed at rest

Chose: Generate 32 random bytes (`crypto.randomBytes(32)`), encode as
base64url for the token that goes in the link/QR code, and store only its
SHA-256 hash in the database.

Because: This is the same pattern used by GitHub, Django, and Rails for
password-reset and invite links. The token itself never touches the
database in plaintext, so a database dump or a lucky SQL injection doesn't
hand over usable invite links — the attacker would need to reverse a SHA-256
hash, which is computationally infeasible for a 256-bit random input (unlike
password hashing, we don't need bcrypt/argon2 here — there's no low-entropy
input to protect against, the token itself already has 256 bits of entropy).

Alternative: A self-contained **signed JWT** invite (using `jose`, already a
dependency from the Keycloak topic) embedding `{ groupId, role, exp }`,
verified by signature instead of a database lookup.

Drawback of alternative: A JWT's whole appeal is *statelessness* — you can
verify it without touching the database. But an invite has requirements a
stateless token can't satisfy alone: it must be usable exactly **once**, and
an owner must be able to **revoke** it before it's used or before it expires.
Both of those require a database row anyway (to mark `used_at`, to allow
`DELETE`). Once you need the row, the JWT's signature is doing no extra work
— you'd be maintaining two overlapping systems (a JWT verifier *and* a DB
check) instead of one. So despite "signed tokens" in the roadmap label, the
right lesson here is: **use a JWT when you want to avoid a database
round-trip; use an opaque hashed token when you need single-use/revocable
semantics** — the trip is unavoidable either way, so pick the simpler system.

### Decision 2 — Membership identity: reuse the Keycloak `sub`, not a `users` table

Chose: `group_members.user_id` stores the raw Keycloak `sub` string (text),
exactly like `Group.ownerId` already does.

Because: `db/schema.sql` was written against a `users` table (`SERIAL id`,
`keycloak_sub` column) that documents an *intended* design, but no `User`
entity or user-sync flow was ever built — `Group.ownerId` and
`AuditLog.actorId` both already store the raw `sub` directly. Introducing a
real `users` table now would mean also building a "sync user on first login"
step, which is a whole separate topic, not something an invite-accept
endpoint should quietly take on as a side effect.

Alternative: Build the `users` table first, with an upsert-on-login hook,
and make `group_members.user_id` a proper integer foreign key as
`db/schema.sql` describes.

Drawback of alternative: Expands this topic's scope into user-account
management, which isn't queued on the roadmap yet. It's also not free to
undo — once other tables have FKs into `users`, retrofitting is harder than
building it deliberately when its own topic comes up.

**Note for later:** `db/schema.sql` is now out of sync with this decision
(same kind of drift the file's own comments mention for the `groups.id`
type). Worth a follow-up pass, not blocking this topic.

### Decision 3 — Where the QR code is generated

Chose: The backend returns only the plain `inviteUrl` string in the
authenticated `POST /groups/:id/invites` response. The QR code image itself
is generated **client-side**, in the browser, from that string.

Because: The server has to return the plain URL either way — the owner
needs a copy-pasteable link, not just an image. Once the client already has
that string, rendering it as a QR code is a pure client-side transform (a
small library drawing to a `<canvas>`); shipping a base64 PNG from the
server instead would mean generating and transmitting extra bytes for
something the browser can produce locally from data it already has. There's
no security difference between the two — the token is exposed to the same
authenticated caller either way — so this comes down to not doing
unnecessary work on a free-tier VM.

Alternative (originally planned): Generate the QR code server-side as a
base64 data URL, returned alongside `inviteUrl` in the same response.

Drawback of alternative: An extra dependency (`qrcode` npm package) and
CPU/bandwidth cost on the API process for output the client could produce
itself from a string it already has. The one alternative genuinely worth
ruling out — a *public* `GET /invites/:token/qrcode.png` endpoint for
`<img src="...">` embedding — is still wrong regardless of where the QR
image is drawn: it would put the raw, unhashed token directly in a URL,
and URLs get logged (Traefik access logs, browser history, `Referer`
headers) in ways an authenticated POST body doesn't — see `auth.guard.ts`'s
WebSocket handshake comment for the same lesson applied to WS tokens.

### Decision 4 — Registration itself is invite-gated, not just group membership

The first draft of this topic (and the worked example below) assumed the
"hard part" was the invite; account creation was somebody else's problem —
Keycloak's hosted login page has a "Register" link, and `AuthGuard` doesn't
care whether the JWT it's checking belongs to someone who registered
yesterday or ten seconds ago via an invite link. That's a real gap: with
`registrationAllowed: true`, anyone who finds the login page can create an
account and simply never join a group. Invite validity (expiry, single-use)
protects `group_members`, but does nothing to protect the platform's front
door itself.

Chose: Turn Keycloak's public self-registration **off**
(`registrationAllowed: false` in `boardgame-realm.json`), and make the
NestJS API the *only* thing that can create a Keycloak account — via
Keycloak's Admin REST API, and only after independently validating an
invite. Concretely, two public (unauthenticated) endpoints instead of one:

- `GET /invites/:token` — read-only preview. Validates the invite (exists,
  unused, unexpired) but does **not** consume it. Lets the frontend show
  "You're invited to *Alice's Board Game Group*" before anyone commits to
  registering.
- `POST /invites/:token/register` — re-validates the invite (never trust
  the earlier `GET` — time has passed, someone else may have used it since),
  creates the Keycloak account via the Admin API, marks the invite used, and
  inserts the `group_members` row, in that order, as one operation. New
  account and first group membership happen together — there's no window
  where an account exists but is orphaned from the invite that justified it.

The already-planned `POST /invites/:token/accept` (authenticated) is
unchanged — it's for someone who **already** has an account (invited to a
*second* group) and needs no new Keycloak user at all.

Because: This is the only way to make "invite-only" actually mean
invite-only. Keycloak's hosted registration page has no concept of our
`invites` table — the only way to make it *aware* is to stop using it for
registration and have our own API be the gatekeeper instead, using the same
Admin API that platforms like this normally reserve for admin consoles.

Alternative: Keep `registrationAllowed: true` but add a required field
("invite code") to Keycloak's own registration form.

Drawback of alternative: Doing this properly requires writing a custom
Keycloak Authentication SPI (a Java provider) to validate that field against
our Postgres `invites` table mid-flow — real infrastructure work, in a
different language, for a self-hosted instance with no existing Java
tooling in this project. Turning registration off and mediating it
ourselves reuses a REST API Keycloak already exposes, in the same
TypeScript codebase as everything else.

**New privileged surface this introduces:** the API now holds a Keycloak
client credential (`client_id` + `client_secret`) with the realm's
`manage-users` role — broad power to create/modify/disable any user in the
realm, not just "create one user with one specific role." That's a real
increase in blast radius if this credential ever leaked (compare to
`3_vault`'s dynamic-secrets discussion — this is exactly the kind of static,
long-lived, high-privilege credential Vault exists to eventually manage,
though for now it follows the same plain-env-var pattern as
`AUTH_KEYCLOAK_SECRET`, a known gap `3_vault.md` already flagged, not new
scope for this topic).

**Bootstrap problem this creates:** if registration is invite-only, who
invites the very first user? Per your call, an ordinary `seed-admin.ts`
script — not a NestJS endpoint, just a one-time-run script — uses the same
Admin API to create exactly one account from
`BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` env vars. That person
logs in and creates their own first group normally (`POST /groups` was
never invite-gated — only *account creation* is) — from there, every
subsequent user arrives strictly through an invite that account (or someone
it later invites) generated.

**Password handling for `register`:** the Admin API's usual "safest"
pattern is to create the account with a *temporary* credential and a
`requiredActions: ["UPDATE_PASSWORD"]` flag, so Keycloak forces the user to
set their real password on first login rather than our own endpoint ever
touching one. That pattern depends on having a way to hand the user that
temporary credential — normally, Keycloak emails them a set-password link.
This project has no SMTP/email-sending module, so that channel doesn't
exist. Given that constraint, `register`'s request body includes a real
password chosen by the invitee, passed straight through as the account's
actual credential (`credentials: [{ type: 'password', value, temporary:
false }]`). Our own DTO validates it via `class-validator` (minimum length);
Keycloak's realm-level password policy — currently unset — would layer on
top if one's added later. If email infra is ever built, this is worth
revisiting in favor of the temporary-credential pattern.

**The orphaned-account failure mode:** `registerAndAcceptInvite` calls
Keycloak's Admin API (`createUser`) *before* writing anything to Postgres
(`redeem`, which marks the invite used and inserts `group_members`). These
are two separate systems with no shared transaction — if `createUser`
succeeds and `redeem` then fails, you're left with a real Keycloak account
that belongs to no group, created by an invite that may already be marked
used. `InvitesService` handles this with a **compensating action**: if
`redeem` throws after `createUser` succeeded, it calls
`KeycloakAdminClient.deleteUser` to remove the account it just created,
so a retry with the same email doesn't collide with an unusable orphan.
That cleanup call is itself best-effort — logged if it fails, not retried
or escalated — because by that point the original error is already the
thing that needs surfacing; compounding it with a second, different failure
would only make the real problem harder to see. This is the same
"good enough for the actual failure rate, not a full distributed
transaction" posture `AuditService.log` already takes (it logs and swallows
DB write failures rather than failing the whole request) — worth naming
explicitly here since the stakes (an account that can never be used) are
higher than a missing audit row.

---

## Worked Example

This is NOT the board game platform code. It's a minimal, single-file
Express-style example for a fictional "team notes" app, isolating just the
token lifecycle and QR generation with an in-memory store instead of Postgres.

### Scenario

A team owner wants to invite someone to their team. They hit an endpoint to
generate an invite link + QR code. The invitee scans it, hits an accept
endpoint, and becomes a team member — and the same link can't be used again.

### Code / Configuration

```typescript
import { randomBytes, createHash } from 'crypto';

// In-memory stand-ins for two database tables.
// invites: token lifecycle, keyed by hash (the hash IS the primary key —
// no separate surrogate id, since the hash is already unique by construction).
// members: the join table an accepted invite writes to.
const invites: Map<string, { teamId: string; role: string; expiresAt: number; usedAt: number | null }> = new Map();
const members: { userId: string; teamId: string; role: string }[] = [];

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days — matches the project's default

// Hashing is deterministic and one-way: same input always produces the same
// output, but you cannot recover the input from the output. That's exactly
// the property we want for "does this presented token match a stored one?"
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

// Step 1: an existing team owner/admin calls this to create an invite.
function createInvite(teamId: string, role: 'admin' | 'member', creatorRole: string) {
  // Role check happens BEFORE any token is generated — a 'member' should
  // never be able to mint an invite, let alone an 'admin' invite.
  if (creatorRole !== 'owner' && creatorRole !== 'admin') {
    throw new Error('403: only owners and admins may create invites');
  }

  const rawToken = randomBytes(32).toString('base64url'); // the secret — shown to the caller ONCE
  const tokenHash = hashToken(rawToken);                   // the only thing that gets stored, and its PK

  invites.set(tokenHash, {
    teamId,
    role,
    expiresAt: Date.now() + INVITE_TTL_MS,
    usedAt: null,
  });

  const inviteUrl = `https://example.app/invites/${rawToken}`;
  // That's it — no QR code here. The caller (a browser) already has the
  // string it needs; turning a URL into a QR code is a pure client-side
  // transform (draw to <canvas>), not something worth a server round trip for.
  return { inviteUrl }; // rawToken only ever leaves the server in this response
}

// Step 2: the invitee, now authenticated (has their own account), calls this
// with the raw token from the URL they scanned/clicked.
function acceptInvite(rawToken: string, acceptingUserId: string) {
  const tokenHash = hashToken(rawToken); // re-hash the presented token to compare
  const invite = invites.get(tokenHash);

  if (!invite) throw new Error('404: invite not found'); // wrong token, or never existed
  if (invite.usedAt) throw new Error('410: invite already used');
  if (Date.now() > invite.expiresAt) throw new Error('410: invite expired');

  invite.usedAt = Date.now(); // mark consumed BEFORE the membership write completes below,
                              // so a crash between these two lines fails safe (invite is
                              // burned even if the membership row didn't make it — better
                              // than a reusable token surviving a partial failure)
  members.push({ userId: acceptingUserId, teamId: invite.teamId, role: invite.role });

  return { teamId: invite.teamId, role: invite.role };
}
```

### What Is Happening Step by Step

1. **`createInvite` checks the caller's existing role first.** Nothing about
   token generation is reachable by a plain `member` — the permission check
   is the very first thing that runs.

2. **`randomBytes(32)` generates the actual secret.** 32 bytes = 256 bits of
   entropy — brute-forcing this by guessing is not a realistic attack, unlike
   a 6-digit invite code would be.

3. **The raw token is hashed before storage.** `invites` (the "database")
   never contains a value that could be used to accept the invite directly —
   only something you'd need to already have the raw token to reproduce.

4. **The raw token is returned to the caller exactly once**, embedded in a
   plain URL. After this function returns, the server holds no copy of the
   plaintext token anywhere — only its hash. Whatever the client does with
   that URL next (display it as a link, render it as a QR code) happens
   entirely on the client, from data it already has — no second server call.

5. **`acceptInvite` re-hashes whatever token it's given** and looks up that
   hash. This is why hashing has to be deterministic (same input → same
   output) rather than salted like a password hash — there's no way to "try
   every stored hash" the way you can with bcrypt, so a lookup by exact hash
   match is the only option, and it's the correct one here.

6. **`usedAt` is set before the membership row is written.** This ordering
   matters — see the section below.

### What Would Break If You Changed X?

If you removed the `if (invite.usedAt)` check, the same QR code could be
scanned by an unlimited number of people, turning a "one invite" flow into
"anyone who ever sees this image is now a member" — including anyone who
finds the QR code in a screenshot or a photo posted publicly after the
first, legitimate use.

If you swapped the order of the last two lines in `acceptInvite` — writing
the membership row, *then* setting `usedAt` — a crash or an error thrown by
the membership write in between would leave the invite un-marked-as-used.
The invitee would see an error, retry, and it would work again (fine), but
so would anyone else who still had that link, until the process eventually
got around to (or failed to) mark it used. Marking `usedAt` first means the
worst case of a crash is "one legitimate invite has to be re-issued," not
"one invite is silently reusable."

**One more race the worked example leaves open on purpose, for simplicity:**
`if (invite.usedAt) throw ...` followed later by `invite.usedAt = ...; save(...)`
is a **read, then separately write** — it does not stop two *concurrent*
calls from both reading `usedAt: null` before either one writes. The real
`InvitesService.redeem()` closes this with a single conditional `UPDATE`:

```sql
UPDATE invites SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL
```

This is one atomic statement as far as Postgres is concerned — of two
concurrent callers, only one can be the one whose `WHERE used_at IS NULL`
still matches at the instant it runs; the loser's `UPDATE` matches zero
rows, and the code checks that (`result.affected === 0`) to reject it. The
worked example's plain "check, then write" is fine for learning the
*ordering* lesson above, but a real single-use guarantee needs the check
and the write to be the *same* database operation, not two.

---

## Aside: Where Does Keycloak Registration Fit?

The worked example's `acceptInvite(rawToken, acceptingUserId)` takes
`acceptingUserId` as a given, already-known value — it doesn't ask "does
this user actually exist yet?" That's deliberate: it models the **existing
user** path only. Per Decision 4, there are now two separate paths, and
which one runs depends on whether the invitee already has a Keycloak
account:

**Path A — invitee already has an account** (invited to a second group):

1. They open the invite link while logged out (or already logged in).
2. The frontend calls `GET /invites/:token` to preview it (no auth
   required, doesn't consume it) and shows "You're invited to *X*."
3. If not already logged in, the frontend sends them to Keycloak's login
   page — **registration is off**, so this page can now only authenticate
   an existing account, never create one.
4. Keycloak issues a JWT. The frontend calls
   `POST /invites/:token/accept` with that JWT. `AuthGuard` verifies it
   first — this is where `acceptingUserId` in the worked example comes
   from — then the token-hash/expiry/used-check logic runs.

**Path B — invitee has no account yet** (the common case for "grow through
friends"):

1. Same steps 1–2 as above.
2. The frontend shows a registration form and calls
   `POST /invites/:token/register` — **no JWT involved at all**, because
   there is no account yet to issue one. This endpoint re-validates the
   invite itself (never trusting the earlier preview call), then uses the
   Admin API to create the Keycloak account, marks the invite used, and
   inserts the `group_members` row.
3. Only *after* the account exists does the frontend send them to
   Keycloak's login page to actually sign in and get a JWT for subsequent
   requests.

The key shift from the original (wrong) assumption: **`AuthGuard` protects
`accept`, but cannot protect `register` — there's no JWT yet for it to
check.** `register`'s only line of defense is re-validating the invite
itself, which is exactly why "re-validate, don't trust the earlier `GET`"
in Decision 4 matters — it's not a redundant safety net, it's the *entire*
gate for this path.

Either way, the JWT and the invite token keep answering two different
questions:

- **The JWT (Path A) answers "who is this, verified?"** — authentication,
  Keycloak's responsibility, already built in [[3_keycloak]].
- **The invite token (both paths) answers "was this specific access grant
  actually issued, and used at most once?"** — authorization/entitlement,
  and in Path B, it's also standing in for "is this person allowed to have
  an account here at all."

---

## Now Apply It

In the actual codebase, this becomes a new `keycloak` module, a new
`invites` module (mirroring the existing `groups` module's shape), and a
`GroupMember` entity, generated one piece at a time next:

- `infra/keycloak/boardgame-realm.json` — `registrationAllowed: false`, and
  a new confidential client with `serviceAccountsEnabled: true` holding the
  `manage-users` role, mirroring how the `web` client is already configured
  (see Decision 4).
- `.env.example` — a new client-secret var for that service account
  (following the exact same "blank on purpose, copy from Keycloak after
  first `up`" pattern as `AUTH_KEYCLOAK_SECRET`), plus
  `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD` for the seed script.
- `apps/api/src/keycloak/keycloak-admin.client.ts` — an `@Injectable()`
  NestJS service using `HttpService` (same `@nestjs/axios` pattern as
  `BggService`, for the same reason: a mockable HTTP client the test suite
  can swap out, see `bgg.service.spec.ts`), wrapping two Keycloak Admin API
  calls: get a client-credentials token, create a user.
- `apps/api/src/groups/group-member.entity.ts` — the join table entity;
  compare its `userId` column to `Group.ownerId` in `group.entity.ts` for the
  "raw Keycloak sub as text" pattern from Decision 2. *(Already generated.)*
- `apps/api/src/invites/invite.entity.ts` — `tokenHash` as the **primary
  key** (no separate surrogate `id` — the hash is already unique by
  construction), plus `expiresAt`, `usedAt`, `usedBy`, `role`, `groupId`,
  `createdBy`; compare to the `invites` Map in the worked example — same
  fields, now as real columns. `usedBy` isn't strictly required by the
  redemption logic (the caller already knows who they are) but is kept so
  "who did this invite end up being used by" is answerable directly from
  this row, without joining through `group_members` or the audit log.
- `apps/api/src/invites/invites.service.ts` — `previewInvite` (Path A/B
  step 2, read-only), `acceptInvite` (Path A, matches the worked example),
  and `registerAndAcceptInvite` (Path B: re-validate, create Keycloak user
  via `KeycloakAdminClient`, mark used, insert `group_members`), calling
  `AuditService.log` for `group.invite_created`, `group.member_joined`, and
  `group.member_registered` (see `secops.md`'s audit logging checklist).
- `apps/api/src/invites/invites.controller.ts` — `POST /groups/:id/invites`
  (authenticated, owner/admin only), `GET /invites/:token` (public),
  `POST /invites/:token/register` (public), `POST /invites/:token/accept`
  (authenticated).
- `apps/api/src/groups/groups.service.ts` — `findAll`/`findOne` updated to
  check `group_members` (owner OR member), not just `ownerId`; `create`
  updated to also insert an `owner`-role `group_members` row for the
  creator, since group creation itself was never invite-gated.
- `db/schema.sql` — updated `group_members.user_id` and the whole `invites`
  table to actually match the entities above (TEXT identity columns, no
  `users(id)` FK, `token_hash` as the PK, a `role` CHECK). Also fixed a
  pre-existing gap unrelated to this topic: `groups` was missing an
  `owner_id` column entirely, even though `group.entity.ts` has always had
  one — worth knowing this file had drifted further than just the invite
  system before this session started.
- `apps/api/scripts/seed-admin.ts` — one-time script that bootstraps a
  minimal Nest application context (`NestFactory.createApplicationContext`)
  just far enough to resolve a `KeycloakAdminClient` instance, then calls it
  directly (no invite involved) to create exactly one account from
  `BOOTSTRAP_ADMIN_*` env vars. This reuses the same tested code path as the
  real `register` endpoint instead of re-implementing the Admin API calls
  a second time.

---

## SecOps Notes

**Security property upheld:** Least-privilege, single-use, time-bounded
delegation of access — an invite grants exactly the group + role it was
created for, exactly once, and only within its validity window. This is the
same family of property as Vault's dynamic secrets ([[3_vault]] if you want
to compare): a credential that expires and can't be replayed is safer than
one that works forever.

**What attack this mitigates:** Without hashing, a leaked database backup
(or a misconfigured backup bucket, or a compromised read replica) would hand
over every outstanding invite link directly — instant unauthorized access to
every group with a pending invite. Without expiry, an invite posted in a
public Discord six months ago for "come join our board game group" stays
live forever. Without single-use enforcement, one invite meant for one
person becomes an open door for anyone who ever sees the link or QR image.

**What would go wrong if skipped:**
- Skip hashing → DB compromise = instant account takeover of the invite
  mechanism, no brute-forcing required.
- Skip expiry → old, forgotten invite links become a permanent unmonitored
  entry point.
- Skip single-use → a QR code photographed once and shared further grants
  unlimited access, silently, with no signal in the audit log distinguishing
  "10 legitimate joins" from "1 invite, reused 10 times."
- Skip the role check in `createInvite` → any `member` could mint an
  `admin` invite for themselves, a straightforward privilege escalation —
  this is the OWASP Broken Access Control pattern from [[2_owasp]] applied
  to a new endpoint.
- Skip re-validating the invite inside `registerAndAcceptInvite` (trusting
  the earlier `GET /invites/:token` preview instead) → a TOCTOU (time-of-
  check to time-of-use) bug: the invite could expire, or get used by someone
  else, in the gap between the preview call and the register call, and a
  stale "yes this was valid" from the preview would create an account anyway.
- Leave `registrationAllowed: true` → the entire invite system becomes
  theater. Anyone can create an account through Keycloak's own page and
  simply never touch the invite flow at all — exactly the gap that
  prompted Decision 4.
- Over-scope the new Keycloak service account (e.g. grant it full
  `realm-admin` instead of just `manage-users`) → a leaked client secret
  now means realm takeover (create/delete/reconfigure anything), not just
  "create users." Grant the narrowest client role the Admin API calls
  actually require.

---

## Checkpoint Questions

1. Why is the invite token hashed with plain SHA-256 instead of bcrypt or
   argon2, when those are the "correct" way to hash a password?
2. Walk through what happens if two people scan the same QR code within a
   second of each other. Is there a race condition in the worked example's
   `acceptInvite`, and if so, where?
3. Why does `group_members.user_id` store the Keycloak `sub` as text instead
   of a foreign key to a `users` table, even though `db/schema.sql` shows a
   `users` table?
4. If this broke in production — invites created successfully but
   `acceptInvite` always returned 404 — where would you look first?
5. Why doesn't the backend generate the QR code image at all, and why would
   a public `GET /invites/:token/qrcode.png` endpoint be a bad idea even if
   it did?
6. Why can't `AuthGuard` protect `POST /invites/:token/register` the way it
   protects `POST /invites/:token/accept`? What protects `register` instead?
7. What is the actual difference in *scope of damage* between the
   `AUTH_KEYCLOAK_SECRET` the `web` client already uses, and the new client
   secret `KeycloakAdminClient` uses?
8. Why is the atomic `UPDATE ... WHERE used_at IS NULL` in `redeem()` needed
   even though `findValidInvite` already checks `usedAt` before it's called?
9. In `registerAndAcceptInvite`, if `deleteUser` (the compensating cleanup)
   itself fails, the code logs it and re-throws the *original* error rather
   than the cleanup error. Why is that the right choice, and what would go
   wrong if it threw the cleanup error instead?

---

## Rewrite Exercise

Delete `invite.entity.ts`, `invites.service.ts`, and `invites.controller.ts`
once generated, and recreate them from memory using this note as a
conceptual reference only (not the code itself).

Focus on: getting the **ordering** right in `acceptInvite` — the
existence check, the used check, the expiry check, marking used, and only
then writing the membership row. This is the part most likely to be
reordered incorrectly on a rewrite, and reordering it is exactly what
reintroduces the race condition from Checkpoint Question 2.

It is fine if your version differs from the generated one — what matters
is that you can explain every line you write.

---

## Summary

Built: a full invite-gated membership system. `GroupMember` (join table,
owner/admin/member roles) and `Invite` (SHA-256-hashed, single-use, 7-day
tokens) entities; `InvitesService` with `previewInvite` (public read-only),
`acceptInvite` (Path A, existing account), and `registerAndAcceptInvite`
(Path B, brand-new account via a Keycloak Admin API client, with
compensating cleanup if the local DB write fails afterward); a new
`KeycloakModule`/`KeycloakAdminClient` calling Keycloak's Admin REST API
via a dedicated `api-service` service-account client; `registrationAllowed:
false` in the realm config, closing the gap where anyone could self-register
regardless of invite status; `GroupsService` updated to check
`group_members` instead of `Group.ownerId` for read access, with a separate
owner/admin-only check for mutations; a `seed-admin.ts` bootstrap script;
and `db/schema.sql` brought back in sync (including a pre-existing,
unrelated gap — a missing `groups.owner_id` column). 38 tests pass across
the whole API; the atomic single-use guard and the orphaned-account
compensating cleanup both have dedicated test coverage.

Demonstrated understanding of: the `getServiceToken` cache race (correctly
reasoned through the exact line ordering once pointed at it, and correctly
concluded duplicate token fetches are harmless, not a failure); the
distinction between a single-use opaque token and a reusable bearer
credential; the "Keycloak session/registration vs. invite entitlement" split
(independently identified the original design gap — that registration
wasn't actually gated by invite validity — before this note accounted for
it, which is what drove Decision 4); the base64url-vs-base64 URL-survival
reasoning behind the token encoding, reached through guided questioning
rather than being told directly; and the NestJS module/provider distinction
(entities aren't "exported," providers are — correctly concluded a third
module needs zero changes to `GroupsModule`, just its own
`TypeOrmModule.forFeature([GroupMember])`, matching the pattern already
comment-documented in `invites.module.ts`).

To revisit: no automated tests yet for `KeycloakAdminClient` itself (only
`InvitesService`, mocking `KeycloakAdminClient` — see `bgg.service.spec.ts`
for the pattern to follow, mocking `HttpService` instead) or for the
updated `GroupsController`/`GroupInvitesController`/`InvitesController`
routing layer (e2e-style, guard-mocking tests, same shape as
`groups.controller.spec.ts`). Also revisit the "Password handling for
register" decision if SMTP/email infra is ever built — the temporary-
credential pattern would be strictly better once that channel exists. And
`db/schema.sql`'s `users` table plus the `INT REFERENCES users(id)` columns
on `game_ownership`, `reviews`, `play_session_players`, and
`play_session_game_results` are the same "aspirational, never actually
implemented" pattern this topic fixed for `group_members` and `invites` —
worth a dedicated pass whenever those features' own topics come up.
