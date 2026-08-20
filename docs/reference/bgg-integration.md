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

Two modules currently own this:

- `apps/api/src/bgg/bgg.service.ts` (`BggService`) — the only thing that
  talks to BGG's HTTP API. Owns the polling loop and XML parsing.
- `apps/api/src/games/games.service.ts` (`GamesService`) — the cache layer
  in front of it, backed by the `games` table (`apps/api/src/games/game.entity.ts`).

## `BggService`

- `getGame(bggId)` — fetches `thing?id=<id>&stats=1` (`stats=1` is required
  to get the `<ratings>` block at all), polling on `202` up to 5 attempts
  with a 2s delay, then parses the XML into a `BggGame` object.
- Uses one shared `XMLParser` instance (construction isn't free) configured
  with `ignoreAttributes: false` and `attributeNamePrefix: '@_'` — BGG
  stores most numeric values as XML attributes (e.g. `<minplayers
  value="2"/>`), and without `ignoreAttributes: false` those are silently
  dropped, producing `NaN` after `Number()` coercion rather than a visible
  error.
- `isArray: (tagName) => tagName === 'name'` forces `<name>` to always
  parse as an array, even when a game has only one name. Without this, a
  game with alternates comes back as an array while a game with a single
  name comes back as a bare object — an inconsistency that would crash the
  code reading `item.name.find(...)`.
- Any non-200/202 status is treated as unrecoverable and thrown immediately
  as an `HttpException` with BGG's own status code.

## `GamesService`

- `findOrFetch(bggId)` — returns the cached `Game` row if it exists and is
  fresher than `CACHE_TTL_MS` (7 days); otherwise calls
  `BggService.getGame`, persists the result, and returns it. Callers never
  need to know whether the data came from cache or from BGG.
- On a stale-but-existing row, the update reuses the existing row's `id`
  (`{ ...cached, ...bggData, lastFetchedAt: new Date() }`) so TypeORM
  issues an `UPDATE` rather than a second `INSERT`.
- `lastFetchedAt` is a plain `@Column`, deliberately not `@UpdateDateColumn`
  — the latter would fire on *any* update to the row (including a future
  unrelated field), incorrectly resetting the staleness clock without an
  actual BGG fetch having happened.

## Decisions that still hold

- **No background job queue.** BGG fetches happen synchronously,
  fetch-on-demand, with DB caching. Chosen over a BullMQ/Redis queue to
  avoid that operational complexity until there's evidence synchronous
  fetch-on-add is actually too slow at this scale (`notes/2_bgg_integration.md`).
- **`fast-xml-parser` over `xml2js`/`xmldom`.** Zero dependencies,
  async/await-friendly, and lighter than a full DOM implementation this
  use case doesn't need.

## Extension points

Both services are designed to be extended rather than duplicated when new
BGG-backed features are added — see
`docs/superpowers/specs/2026-08-20-bgg-account-linking-design.md` for the
first example: BGG account linking and collection import add
`BggService.getUser`/`getCollection`/`getGamesBatch` and
`GamesService.findOrFetchMany`, built on top of the exact same polling
loop, parser configuration, and cache-freshness check described above,
rather than introducing a second way to talk to BGG.
