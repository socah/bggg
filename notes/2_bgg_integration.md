# BGG XML API2 — XML Parsing, Async Polling, Background Jobs, Caching

**Phase:** 2 — Backend Core
**Topic ID:** 2_bgg_integration
**Date:** 2026-06-29
**SecOps:** No

---

## What Is This?

BoardGameGeek (BGG) exposes a public HTTP API called XML API2. Unlike most
modern APIs, it returns XML (not JSON), and it has an unusual async pattern:
if the data you requested isn't already cached on BGG's servers, it responds
with HTTP 202 (Accepted) instead of the data — meaning "I'm generating it,
try again in a moment." Your client must poll until it gets a real 200 response.

---

## Why Does It Matter for This Project?

Every game in our platform is enriched with BGG data — name, thumbnail,
description, player count, rating. We can't make users wait while we poll
BGG on every page load, so we fetch once, store in our own database, and
serve from there. This is the foundation of the game catalogue in every
group's collection.

---

## The Decision

**Chose:** Fetch-on-demand with DB caching + staleness check; no background
queue for the initial implementation.

**Because:** The simplest thing that works: when a user adds a game to their
group, we fetch from BGG at that moment (with polling retry), store the result,
and serve from DB on all subsequent requests. A `last_fetched_at` timestamp
lets us decide when to re-fetch.

**Alternative:** A full job queue (BullMQ + Redis) that processes BGG fetches
asynchronously in the background.

**Drawback of alternative:** Adds Redis as a dependency and significant
operational complexity. Overkill until we have evidence that synchronous
fetch-on-add is too slow or too unreliable for our scale.

**Chose:** `fast-xml-parser` for XML parsing.

**Because:** Zero dependencies, streaming-capable, straightforward API, and
significantly faster than `xml2js` for this use case.

**Alternative:** `xml2js` or the native `DOMParser` (via `@xmldom/xmldom`).

**Drawback of alternative:** `xml2js` has a callback-first API that is awkward
with async/await; `xmldom` is heavier and designed for full DOM manipulation
we don't need.

---

## Worked Example

This example is NOT the project code. It is a standalone illustration of
the two key concepts: async polling until success, and XML parsing.

### Scenario

Imagine a "movie info" API that works just like BGG: send it an IMDB id,
get XML back — but sometimes it returns 202 and you have to retry.

### Code / Configuration

```typescript
import { XMLParser } from 'fast-xml-parser';

// Simulates the remote API. Returns 202 on first call, 200 with XML on second.
async function fakeMovieApi(id: string, call: number): Promise<{ status: number; body: string }> {
  if (call === 1) {
    return { status: 202, body: '' }; // "not ready yet"
  }
  return {
    status: 200,
    body: `
      <movie id="${id}">
        <title>Inception</title>
        <year>2010</year>
        <rating value="8.8" />
      </movie>
    `,
  };
}

// Polls until the API is ready, then returns the raw XML string.
// maxRetries prevents an infinite loop if the API is permanently broken.
async function pollUntilReady(
  id: string,
  delayMs = 1000,
  maxRetries = 5,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { status, body } = await fakeMovieApi(id, attempt);

    if (status === 200) return body;

    if (status === 202) {
      // The remote server is still generating the response — wait and retry.
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    // Any other status is an unrecoverable error.
    throw new Error(`Unexpected status ${status} from movie API`);
  }

  throw new Error(`Movie API did not respond after ${maxRetries} retries`);
}

// Parses the XML string into a plain JS object we can use.
function parseMovieXml(xml: string): { id: string; title: string; year: number; rating: number } {
  const parser = new XMLParser({
    ignoreAttributes: false,   // keep XML attributes like `value="8.8"`
    attributeNamePrefix: '@_', // prefix attrs so they don't collide with child elements
  });

  const result = parser.parse(xml);
  const movie = result.movie;

  return {
    id: movie['@_id'],          // the `id` attribute on <movie>
    title: movie.title,
    year: Number(movie.year),
    rating: Number(movie.rating['@_value']), // attribute, not text content
  };
}

// Ties it together: fetch with polling, then parse.
async function getMovie(id: string) {
  const xml = await pollUntilReady(id);
  return parseMovieXml(xml);
}

// Run it
getMovie('tt1375666').then(console.log);
// { id: 'tt1375666', title: 'Inception', year: 2010, rating: 8.8 }
```

### What Is Happening Step by Step

1. `pollUntilReady` calls the remote API in a loop, up to `maxRetries` times.
2. On attempt 1, the fake API returns 202 — the function waits `delayMs`
   milliseconds and tries again. This is the async polling pattern.
3. On attempt 2, the fake API returns 200 with the XML body — the function
   returns it immediately.
4. `parseMovieXml` creates an `XMLParser` with `ignoreAttributes: false`.
   Without this flag, attributes like `value="8.8"` are silently dropped.
5. `parser.parse(xml)` converts the XML string into a plain JS object. The
   `attributeNamePrefix: '@_'` option means `<rating value="8.8">` becomes
   `{ rating: { '@_value': '8.8' } }` — the prefix avoids collisions if
   an element has both a child element and an attribute with the same name.
6. The parsed fields are extracted and coerced to the right types (`Number()`),
   since XML has no native number type — everything comes out as a string.

### What Would Break If You Changed X?

Remove `ignoreAttributes: false` from the parser options. The `<rating
value="8.8" />` element has no text content — only an attribute. Without
attribute parsing enabled, `result.movie.rating` would be `undefined` or an
empty string. `Number(undefined)` is `NaN`. The bug is silent: the code
runs, the data inserts, and you end up with `NaN` ratings in your database.

---

## Now Apply It

In the board game platform, this pattern appears in:

- `apps/api/src/bgg/bgg.service.ts` — the service that calls the BGG XML API2,
  implements the polling retry loop, parses the XML, and returns a typed object
- `apps/api/src/bgg/bgg.module.ts` — registers `BggService` as a provider and
  imports `HttpModule` (NestJS's `axios`-backed HTTP client)
- `apps/api/src/games/game.entity.ts` — the entity that stores cached BGG data
  (id, name, thumbnail, min/max players, rating, `last_fetched_at`)
- `apps/api/src/games/games.service.ts` — the service that checks whether a
  game is in the DB cache before calling `BggService`, and decides when to
  re-fetch based on `last_fetched_at`

---

## Checkpoint Questions

1. Why does BGG's API sometimes return 202 instead of 200, and what does
   your code need to do differently when it receives a 202?
2. What would happen if you forgot to set `ignoreAttributes: false` when
   parsing a BGG XML response that uses attributes to store ratings?
3. Where does the cached BGG data live in the system, and what field
   controls when it gets refreshed?
4. Why did we choose synchronous fetch-on-add over a background job queue
   for the initial implementation?
5. What is `attributeNamePrefix` for, and when would you need to change it?

---

## Summary

Built: `BggService` (HTTP polling + XML parsing), `BggModule`, `Game` entity (DB cache table), `GamesService` (cache-check layer), `GamesModule`, and registered everything in `AppModule`.

Demonstrated understanding of: the async polling pattern and why 202 requires a retry loop; why `ignoreAttributes: false` is required and what silently breaks without it; why `isArray` is needed for consistent tag handling; the distinction between TypeScript imports and NestJS DI module imports; why `unique: true` on `bggId` prevents duplicate cache rows; why `@UpdateDateColumn` was rejected for `lastFetchedAt`; and the full `findOrFetch` flow including the `...cached` spread carrying over `id` for UPDATE vs INSERT.

To revisit: the distinction between a foreign key and a unique constraint on an external ID — initially conflated.
