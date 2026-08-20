# BGG Account Linking & Collection Import

**Date:** 2026-08-20
**Status:** Approved for planning

---

## Problem

Every game in the platform is enriched with BGG data (`BggService` + `GamesService`,
see `notes/2_bgg_integration.md`), but only when a game is added one at a time.
There's no way for a user to link their BoardGameGeek account and pull in their
existing collection in bulk. Without this, populating a group's game library
means manually adding every game a member owns, one by one.

## Goals

- A user can link their BGG account by username.
- A user can trigger an import of their owned-games collection from BGG,
  which populates/refreshes the shared game catalogue and records which
  games this user owns.
- Re-running import keeps ownership in sync with BGG (adds new games,
  removes ones no longer marked "own" on BGG).
- A user can see their own linked account and their imported games via the API.
- A user can unlink their account without losing previously imported
  ownership data.

## Non-goals

- No OAuth or credential-based verification of BGG account ownership — BGG
  has no such mechanism for third parties; the collection is public data
  keyed by username. We only verify the *username exists*.
- No wishlist import or wishlist tab. BGG's collection endpoint supports a
  separate `wishlist=1` query and this will get its own table
  (e.g. `GameWishlist`) in a later feature; nothing in this design should
  need to be reworked to add it.
- No background job queue. Import stays synchronous, consistent with the
  existing decision in `notes/2_bgg_integration.md` to avoid Redis/BullMQ
  until there's evidence synchronous fetch is actually too slow.
- No frontend UI. Every other feature module in this repo (games, groups,
  scheduling, chat, uploads, calendar) is API-only so far — `apps/web` only
  has auth/login routes. This feature follows the same pattern.

## Approach

### Modules

New `apps/api/src/collections/` module (`CollectionsModule`), following the
existing split where `BggService` only talks to BGG's HTTP API and
`GamesService` is the cache layer for the shared catalogue:

- `CollectionsModule` imports `BggModule` (username verification + fetching
  the collection list) and `GamesModule` (batch-hydrating games into the
  catalogue).
- `CollectionsService` owns the per-user account link and ownership rows,
  built on top of `BggService` and `GamesService`. It does not talk to BGG
  directly for game data — it delegates to `GamesService.findOrFetchMany`.
- `CollectionsController` is guarded by the existing `AuthGuard` and reads
  the Keycloak `sub` from `request.user.sub`, the same identity anchor
  `GroupMember`, `AuditLog`, and every other module already use.

### BggService additions

- `getUser(username): Promise<{ id: number; username: string }>` — calls
  BGG's `user?name=<username>` endpoint. This endpoint is synchronous (no
  202/polling behavior) — used purely to confirm the username exists before
  saving a link. Throws 404 if BGG has no such user.
- `getCollection(username): Promise<{ bggId: number; name: string }[]>` —
  calls `collection?username=<username>&own=1`, reusing the existing
  202-then-retry polling loop from `fetchWithPolling`. Returns just enough
  to know *which* games are owned; full stats are hydrated separately.
- `getGamesBatch(bggIds: number[]): Promise<BggGame[]>` — calls `thing`
  with a comma-separated `id` list (BGG supports fetching multiple items in
  one call), reusing the same polling loop and `parseGame` logic. Handles
  both the single-item and multi-item response shapes from `fast-xml-parser`
  (an `items.item` of length 1 doesn't come back as an array unless
  `isArray` is configured for `item` too — needs the same treatment as the
  existing `name` tag).

### GamesService addition

- `findOrFetchMany(bggIds: number[]): Promise<Game[]>` — same
  cache-freshness check as `findOrFetch` (`isStale` against
  `CACHE_TTL_MS`), but for the *whole list at once*: querying cache hits in
  one query, then chunking only the stale/missing ids into `getGamesBatch`
  calls (e.g. 20 ids per call, to stay well under any BGG URL-length /
  response-size limits) instead of one `thing` call per game. Games that
  are already fresh in cache never touch BGG at all.

### Data model

Both new entities follow the repo's established identity pattern: the raw
Keycloak `sub` stored as `text`, never a foreign key into a `users` table
(there isn't one — see `group_members`'s existing comment on this, and
`db/schema.sql`'s header).

```
BggAccount (table: bgg_accounts)
  id            PK serial
  userId        text, unique          -- Keycloak sub; one BGG link per person
  bggUsername   text
  linkedAt      timestamptz (set on link, via @CreateDateColumn-equivalent)

GameOwnership (table: game_ownership)
  id            PK serial
  userId        text                  -- Keycloak sub
  gameId        int, FK -> games.id
  addedAt       date
  UNIQUE (userId, gameId)
```

`db/schema.sql` will be updated to match: `game_ownership.user_id` currently
reads `INT REFERENCES users(id)` there, sketched against a `users` table
that (per the file's own header and `group_members`'s comment) was never
actually built. This gets fixed the same way `group_members` already was —
`user_id TEXT`, no FK — with a comment explaining the drift. A new
`bgg_accounts` table section gets added as the real backing store for the
`users.bgg_username` field the file already sketches (that sketch stays as
historical reference; it was never built either).

Since there is no migration tooling in this repo (`synchronize: false`, no
migration files — `db/schema.sql` is applied manually per its own header),
the new tables need to be created by hand against the dev DB as part of
implementation, the same way `db/schema.sql`'s header instructs.

### API surface

All endpoints guarded by `AuthGuard`, scoped to `request.user.sub`:

- `POST /bgg-account { bggUsername }` — verifies via `BggService.getUser`,
  upserts the link (create or update `BggAccount` row for this `userId`).
  404 if BGG has no such username.
- `GET /bgg-account` — returns the current link, or `null` if none.
- `DELETE /bgg-account` — removes the `BggAccount` row. `GameOwnership`
  rows are kept — they represent real-world ownership, not link state;
  unlinking only stops future imports.
- `POST /bgg-account/import` — 400 if not linked. Otherwise: fetch the
  collection via `getCollection`, hydrate/refresh the `Game` catalogue via
  `findOrFetchMany`, diff the collection's bggIds against this user's
  existing `GameOwnership` rows, insert additions and delete removals in
  one transaction, and return `{ added, removed, total }`.
- `GET /bgg-account/games` — this user's owned games, `GameOwnership`
  joined with `Game`, so import results are actually visible via the API
  (every other module here exposes what it stores; this shouldn't be a
  write-only black box).

### Error handling

- Linking a nonexistent BGG username → 404, propagated from `getUser`.
- BGG unreachable, rate-limited, or erroring during import → the existing
  `HttpException` from `BggService` surfaces as-is, same as `GamesService`
  today. No new retry/backoff layer — consistent with the "no queue, keep
  it simple" decision already made for this integration.
- An empty collection (zero owned games on BGG) is not an error — it's a
  valid sync that may result in `removed > 0` if the user previously had
  ownership rows.

### Testing

Following the existing `.spec.ts` pattern (`bgg.service.spec.ts`,
`games.service.spec.ts`, `groups.service.spec.ts`), with `HttpService`
mocked — no real calls to BGG, matching existing tests:

- `BggService`: `getUser` found/not-found; `getCollection` 202-then-200
  polling and multi-item parsing; `getGamesBatch` comma-id URL construction
  and the single-vs-array `item` parsing edge case.
- `GamesService.findOrFetchMany`: fresh-cache games never trigger a batch
  call; stale/missing games get chunked correctly; upserts land right.
- `CollectionsService`: link verify success/failure; unlink leaves
  ownership rows intact; import diff logic (added/removed computed
  correctly against existing rows) — the highest-value test surface here,
  pure logic once `BggService`/`GamesService` are mocked.
- `CollectionsController`: thin test asserting it calls the service with
  the right `userId` (from `request.user.sub`) and body, matching
  `groups.controller.spec.ts`'s style.

No e2e/integration test against the real BGG API, consistent with existing
tests in this repo.

## Risks

- **BGG rate limiting on large collections.** Chunked batch calls reduce
  request count but a very large collection (500+ games) could still hit
  several `thing` calls plus polling delays within one HTTP request,
  making `POST /bgg-account/import` slow. Accepted for now per the
  existing "no queue until proven necessary" decision; if this becomes a
  real problem, revisit with a background job.
- **`fast-xml-parser`'s array-vs-object ambiguity extends to `item`.** The
  existing code already hit this once for `<name>` (see
  `bgg.service.ts`'s `isArray` comment) — the same bug shape (an object
  instead of an array when there's exactly one match) can recur for
  `items.item` in both `getCollection` and `getGamesBatch` if not
  explicitly configured for `isArray`.
