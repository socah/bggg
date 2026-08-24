# BGG Integration

Living reference for how this platform talks to BoardGameGeek's XML API2 and
caches the results. Describes current behavior — for the history of *why*
it looks like this, see the dated specs in `docs/superpowers/specs/` that
introduced each piece (linked inline below).

## Overview

BGG's XML API2 returns XML, not JSON, and uses an async polling pattern:
some endpoints respond `202 Accepted` while BGG generates the response
server-side, requiring the client to retry until it gets `200`. This
platform never calls BGG directly from a request path a user is waiting
on for long — it fetches once, caches in Postgres, and serves from there.

Three modules currently own this:

- `apps/api/src/bgg/bgg.service.ts` (`BggService`) — the only thing that
  talks to BGG's HTTP API. Owns the polling loop and XML parsing.
- `apps/api/src/games/games.service.ts` (`GamesService`) — the cache layer
  in front of it, backed by the `games` table (`apps/api/src/games/game.entity.ts`).
- `apps/api/src/collections/collections.service.ts` (`CollectionsService`) —
  per-user BGG account linking and collection import, built on top of the
  other two (see "CollectionsService" below).

`bgg.module.ts` registers `HttpModule.register({ validateStatus: () => true,
timeout: 10000 })` — **not** bare `HttpModule`. Axios's default
`validateStatus` only resolves on 2xx; every status-check branch in
`BggService` (`fetchWithPolling`'s `200`/`202`/else, `getUser`'s
`!== 200`) depends on the observable *resolving* with `{status, data}` for
non-2xx responses too, rather than rejecting as a raw `AxiosError`. This
was a real, previously-undetected gap (unit tests mock `HttpService`
directly, so they never exercised axios's real default) — a live 429/5xx
from BGG would otherwise bypass all of this service's intended error
handling.

## `BggService`

- `getGame(bggId)` — fetches `thing?id=<id>&stats=1` (`stats=1` is required
  to get the `<ratings>` block at all), polling on `202` up to 5 attempts
  with a 2s delay, then parses the XML into a `BggGame` object.
- `getGamesBatch(bggIds)` — same polling loop, but requests `thing` with a
  comma-separated `id` list (`id=1,2,3`) and parses every returned `<item>`,
  for hydrating many games in one call instead of one call per game.
- `getUser(username)` — confirms a BGG username exists. This endpoint is
  synchronous (BGG never returns `202` for it), so no polling loop applies.
  BGG responds `200` with an **empty `<user/>`** (no `id` attribute) for a
  username that doesn't exist, rather than a `404` — `getUser` checks for
  the missing `id` attribute and throws itself.
- `getCollection(username)` — fetches `collection?username=<u>&own=1` (same
  202-polling as `thing`), returning the games a user has marked "own".
  BGG can also respond `200` with an `<errors>` payload instead of `<items>`
  (e.g. for a renamed/deleted username) — `getCollection` checks for
  `result.errors` (or a wholesale-missing `result.items`) and throws,
  rather than treating that as "owns nothing". A genuinely empty collection
  (`<items totalitems="0">`) still resolves to `[]`.
- Uses one shared `XMLParser` instance (construction isn't free) configured
  with `ignoreAttributes: false` and `attributeNamePrefix: '@_'` — BGG
  stores most numeric values as XML attributes (e.g. `<minplayers
  value="2"/>`), and without `ignoreAttributes: false` those are silently
  dropped, producing `NaN` after `Number()` coercion rather than a visible
  error.
- `isArray: (tagName) => tagName === 'name'` forces `<name>` to always
  parse as an array, even when a game has only one name — this applies
  parser-wide, including inside `getCollection`'s response, which needed
  its own unwrap-then-read helper (`textOf`) to account for it. Without
  this flag, a game with alternates comes back as an array while a game
  with a single name comes back as a bare object — an inconsistency that
  would crash the code reading `item.name.find(...)`.
- `mapItemToGame` guards against a missing `<name>` element entirely
  (`(item.name ?? []).find(...)`) so one malformed item in a batch response
  can't throw and abort the whole request.
- Any non-200/202 status is treated as unrecoverable and thrown immediately
  as an `HttpException` with BGG's own status code.

## `GamesService`

- `findOrFetch(bggId)` — returns the cached `Game` row if it exists and is
  fresher than `CACHE_TTL_MS` (7 days); otherwise calls
  `BggService.getGame`, persists the result, and returns it. Callers never
  need to know whether the data came from cache or from BGG.
- `findOrFetchMany(bggIds)` — the same cache-freshness rule applied to a
  whole list at once: cache hits never touch BGG; only the stale/missing
  subset is chunked (20 ids at a time) through `getGamesBatch`. If BGG's
  batch response omits a requested id (delisted/unrecognized), that id is
  silently absent from the result — callers that use this for anything
  destructive (see `CollectionsService.importCollection` below) must check
  for a short result themselves; this method does not throw on it.
- `findByIds(ids)` — a plain cache read by internal `Game.id`, no
  freshness check, no BGG involvement. For "list what's already known"
  reads where triggering a live fetch would be surprising.
- On a stale-but-existing row, the update reuses the existing row's `id`
  (`{ ...cached, ...bggData, lastFetchedAt: new Date() }`) so TypeORM
  issues an `UPDATE` rather than a second `INSERT`.
- `lastFetchedAt` is a plain `@Column`, deliberately not `@UpdateDateColumn`
  — the latter would fire on *any* update to the row (including a future
  unrelated field), incorrectly resetting the staleness clock without an
  actual BGG fetch having happened.
- The `games` table (`db/schema.sql`) must match `game.entity.ts` exactly —
  this drifted silently for a long time (the table predates any real
  consumer) and was only caught when `CollectionsService` became the first
  code path to actually query `games` over HTTP. If you add or rename a
  column on `Game`, update `db/schema.sql`'s `games` section and the live
  DB in the same change; there's no migration tooling to catch drift for you.

## `CollectionsService`

Per-user layer on top of the two services above — never talks to BGG
directly for game data, always delegates to `GamesService`.

- `getAccount`/`linkAccount`/`unlinkAccount` — a `BggAccount` row
  (`userId` = raw Keycloak sub, `bggUsername`, `linkedAt`) links a person to
  a BGG username. `linkAccount` verifies via `BggService.getUser` first and
  stores BGG's *canonical* returned username, not necessarily what the
  caller typed. Unlinking only removes this row — it never touches
  `GameOwnership`.
- `importCollection` — fetches the linked user's BGG collection, hydrates
  the shared catalogue via `findOrFetchMany`, then diffs the result against
  existing `GameOwnership` rows and adds/removes to match, inside one
  TypeORM transaction (`this.ownership.manager.transaction(...)`). Refuses
  to sync at all (throws, touches nothing) if `findOrFetchMany` returned
  fewer games than requested — see `findOrFetchMany`'s note above; without
  this guard, a partial hydration would look identical to "no longer
  owned" and delete ownership rows for games the user still owns on BGG.
- `getOwnedGames` — this user's owned games via `GameOwnership` → `Game`
  (by `findByIds`), currently a bare `Game[]`, not a `GameOwnership`/`Game`
  join — `addedAt` isn't exposed by this endpoint today.

## Decisions that still hold

- **No background job queue.** BGG fetches happen synchronously,
  fetch-on-demand, with DB caching. Chosen over a BullMQ/Redis queue to
  avoid that operational complexity until there's evidence synchronous
  fetch-on-add is actually too slow at this scale (`notes/2_bgg_integration.md`).
- **`fast-xml-parser` over `xml2js`/`xmldom`.** Zero dependencies,
  async/await-friendly, and lighter than a full DOM implementation this
  use case doesn't need.

## Extension points

All three services are designed to be extended rather than duplicated when
new BGG-backed features are added. BGG account linking and collection
import (`docs/superpowers/specs/2026-08-20-bgg-account-linking-design.md`)
is the first example — a natural next one is a wishlist tab/import
(BGG's `collection` endpoint also supports `wishlist=1`), which would add
a `GameWishlist`-shaped table alongside `GameOwnership` rather than
overloading it with a status column.
