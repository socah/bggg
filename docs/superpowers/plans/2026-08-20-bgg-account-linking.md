# BGG Account Linking & Collection Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user link their BoardGameGeek username and import their owned-games collection, hydrating the shared game catalogue and recording per-user ownership.

**Architecture:** Extend the existing `BggService` (talks to BGG's HTTP API) with three new methods (`getUser`, `getCollection`, `getGamesBatch`), extend `GamesService` (the cache layer) with a batch-aware `findOrFetchMany`, and add a new `CollectionsModule` on top of both that owns the per-user `BggAccount` link and `GameOwnership` rows.

**Tech Stack:** NestJS, TypeORM (Postgres, `synchronize: false`, no migrations — `db/schema.sql` applied by hand), `fast-xml-parser`, Jest.

**Spec:** `docs/superpowers/specs/2026-08-20-bgg-account-linking-design.md`

## Global Constraints

- No OAuth/credential verification of BGG accounts — only confirm the username exists via BGG's `user` endpoint.
- No background job queue — import stays synchronous, same as the existing `GamesService.findOrFetch` decision.
- No `users` table FK — every new `userId` column is `text`, the raw Keycloak `sub`, matching `GroupMember`/`AuditLog`/every other entity in this repo.
- No frontend work — this repo's other feature modules (games, groups, scheduling, chat, uploads, calendar) are all API-only so far.
- Unlinking a BGG account must never delete `GameOwnership` rows.
- Re-importing must sync ownership both ways: add newly-owned games, remove rows for games no longer owned on BGG.

---

### Task 1: Refactor `BggService` internals to support batch fetching (no behavior change)

**Files:**
- Modify: `apps/api/src/bgg/bgg.service.ts`
- Test: `apps/api/src/bgg/bgg.service.spec.ts` (existing tests must still pass unchanged)

**Interfaces:**
- Produces: `private fetchWithPolling(url: string, maxRetries = 5): Promise<string>` (was `(bggId: number, maxRetries = 5)` — callers now build the full URL themselves), `private mapItemToGame(item: any): BggGame`, `private normalizeItems(parsed: any): any[]`.

This task changes no observable behavior — it only reshapes `BggService`'s private helpers so Tasks 2-4 can reuse them for the `user`/`collection`/batched-`thing` endpoints instead of duplicating the polling loop and item-parsing logic. The existing test suite is the safety net: it must pass unmodified at the end of this task.

- [ ] **Step 1: Run the existing test suite to confirm the starting baseline is green**

Run: `cd apps/api && npx jest bgg.service.spec.ts -v`
Expected: all existing tests PASS (this is the baseline you must not break).

- [ ] **Step 2: Refactor `bgg.service.ts`**

Replace the full contents of `apps/api/src/bgg/bgg.service.ts` with:

```typescript
import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { XMLParser } from 'fast-xml-parser';

// Shape of the data we extract from BGG and hand back to callers.
// This is what gets stored in the DB cache — one field per column.
export interface BggGame {
  bggId: number;
  name: string;
  description: string;
  thumbnail: string;
  image: string;
  minPlayers: number;
  maxPlayers: number;
  playingTime: number;
  yearPublished: number;
  rating: number;
}

@Injectable()
export class BggService {
  // Create the parser once and reuse it — XMLParser construction is not free.
  // ignoreAttributes: false → keep XML attributes (e.g. <minplayers value="2"/>)
  // attributeNamePrefix: '@_' → attributes are stored as '@_value', '@_type', etc.
  //   so they never collide with child element names.
  // isArray → always treat <name> as an array even when there's only one.
  //   Without this, a game with a single name comes back as an object; a game
  //   with alternates comes back as an array. The inconsistency would crash parseGame.
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) => tagName === 'name',
  });

  // HttpService is NestJS's wrapper around axios, provided by HttpModule.
  // Injecting it (rather than calling axios directly) makes the service testable:
  // tests can swap in a mock HttpService without any real HTTP calls.
  constructor(private readonly http: HttpService) {}

  async getGame(bggId: number): Promise<BggGame> {
    // stats=1 adds the ratings block to the response — without it, <ratings> is absent.
    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
    const xml = await this.fetchWithPolling(url);
    return this.parseGame(xml, bggId);
  }

  // Fetches many games in one call via BGG's comma-separated id support on
  // the `thing` endpoint — avoids one HTTP round trip (plus its own 202
  // polling) per game when hydrating a whole imported collection.
  async getGamesBatch(bggIds: number[]): Promise<BggGame[]> {
    if (bggIds.length === 0) return [];

    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggIds.join(',')}&stats=1`;
    const xml = await this.fetchWithPolling(url);
    const result = this.parser.parse(xml);

    return this.normalizeItems(result).map((item) => this.mapItemToGame(item));
  }

  // Confirms a BGG username exists. This endpoint is synchronous — BGG never
  // returns 202 for it — so no polling loop is needed. Used only to verify a
  // username before saving an account link; it can't prove ownership, since
  // BGG has no auth mechanism for third parties to check that against.
  async getUser(username: string): Promise<{ username: string }> {
    const url = `https://boardgamegeek.com/xmlapi2/user?name=${encodeURIComponent(username)}`;
    const response = await firstValueFrom(
      this.http.get<string>(url, { responseType: 'text' }),
    );

    if (response.status !== 200) {
      throw new HttpException(`BGG API returned ${response.status}`, response.status);
    }

    const result = this.parser.parse(response.data);
    const user = result.user;

    // BGG responds 200 with an empty <user/> (no id attribute) for a
    // username that doesn't exist, rather than a 404.
    if (!user || user['@_id'] === undefined) {
      throw new HttpException(`BGG user '${username}' not found`, 404);
    }

    return { username: user['@_name'] };
  }

  // Fetches the games a user has marked "own" on BGG. Returns just enough to
  // know which games to hydrate/own — full stats come from getGamesBatch.
  async getCollection(username: string): Promise<{ bggId: number; name: string }[]> {
    const url = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&own=1`;
    const xml = await this.fetchWithPolling(url);
    const result = this.parser.parse(xml);

    return this.normalizeItems(result).map((item) => ({
      bggId: Number(item['@_objectid']),
      name: this.textOf(item.name),
    }));
  }

  // Polls the given URL until BGG returns 200, up to maxRetries attempts.
  // BGG returns 202 when it needs to generate the response server-side —
  // shared by the `thing` and `collection` endpoints (not `user`, which is
  // synchronous). Takes the full URL rather than building it internally, so
  // getGame/getGamesBatch/getCollection can each supply their own endpoint
  // and query string.
  private async fetchWithPolling(url: string, maxRetries = 5): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // HttpService.get() returns an RxJS Observable, not a Promise.
      // firstValueFrom() subscribes, waits for the first emission, then resolves.
      // responseType: 'text' prevents axios from trying to JSON.parse the XML body.
      const response = await firstValueFrom(
        this.http.get<string>(url, { responseType: 'text' }),
      );

      if (response.status === 200) return response.data;

      if (response.status === 202) {
        // BGG is generating the response. Wait 2 seconds before retrying.
        await this.sleep(2000);
        continue;
      }

      // Any other status (404, 500, etc.) is unrecoverable — stop immediately.
      throw new HttpException(`BGG API returned ${response.status}`, response.status);
    }

    // If we exhausted all retries BGG never became ready. 504 = Gateway Timeout.
    throw new HttpException('BGG API did not respond after max retries', 504);
  }

  private parseGame(xml: string, bggId: number): BggGame {
    const result = this.parser.parse(xml);

    // BGG wraps the response in <items><item>...</item></items>
    const item = result.items?.item;
    if (!item) {
      throw new HttpException(`Game ${bggId} not found on BGG`, 404);
    }

    return this.mapItemToGame(item);
  }

  // Shared by parseGame (single item) and getGamesBatch (many items) — both
  // ultimately hand this one parsed <item> object from fast-xml-parser.
  private mapItemToGame(item: any): BggGame {
    // <name> is always an array (enforced by isArray above).
    // The primary display name has type="primary"; alternates have type="alternate".
    const primaryName = item.name.find(
      (n: Record<string, string>) => n['@_type'] === 'primary',
    );

    // Ratings live at item.statistics.ratings — only present because we passed stats=1.
    const ratings = item.statistics?.ratings;

    return {
      bggId: Number(item['@_id']),
      name: primaryName?.['@_value'] ?? 'Unknown',
      description: item.description ?? '',
      thumbnail: item.thumbnail ?? '',
      image: item.image ?? '',
      // BGG stores numeric values as attributes: <minplayers value="2"/>
      // They come out as strings after parsing — Number() converts them.
      minPlayers: Number(item.minplayers?.['@_value'] ?? 0),
      maxPlayers: Number(item.maxplayers?.['@_value'] ?? 0),
      playingTime: Number(item.playingtime?.['@_value'] ?? 0),
      yearPublished: Number(item.yearpublished?.['@_value'] ?? 0),
      rating: Number(ratings?.average?.['@_value'] ?? 0),
    };
  }

  // fast-xml-parser returns a bare object (not an array) for items.item when
  // the response has exactly one <item> — the same array-vs-object ambiguity
  // <name> already needed isArray for. <item> isn't configured with isArray
  // because that would break parseGame's single-item shape (item.name...);
  // normalizing after the fact here keeps both call shapes working.
  private normalizeItems(parsed: any): any[] {
    const raw = parsed.items?.item;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  // <name> elements in the collection endpoint's response sometimes carry
  // attributes (e.g. sortindex) alongside their text content — when they do,
  // fast-xml-parser returns { '@_sortindex': ..., '#text': 'Gloomhaven' }
  // instead of a plain string.
  private textOf(node: any): string {
    return typeof node === 'string' ? node : (node?.['#text'] ?? 'Unknown');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 3: Run the existing test suite again to confirm nothing broke**

Run: `cd apps/api && npx jest bgg.service.spec.ts -v`
Expected: all existing tests PASS, identical results to Step 1.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bgg/bgg.service.ts
git commit -m "refactor: generalize BggService's polling and item parsing for batch fetches"
```

---

### Task 2: `BggService.getUser`

**Files:**
- Modify: `apps/api/src/bgg/bgg.service.ts` (already implemented in Task 1 — this task is the TDD record for it)
- Test: `apps/api/src/bgg/bgg.service.spec.ts`

**Interfaces:**
- Consumes: `HttpService.get` (mocked, same as existing tests).
- Produces: `BggService.getUser(username: string): Promise<{ username: string }>`, used by `CollectionsService.linkAccount` in Task 7.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/bgg/bgg.service.spec.ts`, inside the top-level `describe('BggService', ...)` block, after the existing `describe('getGame', ...)` block:

```typescript
  describe('getUser', () => {
    it('should return the username when BGG finds the user', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          status: 200,
          data: '<user id="370" name="aldie" termsofuse="https://boardgamegeek.com/xmlapi/termsofuse"></user>',
        }),
      );

      const result = await service.getUser('aldie');

      expect(result).toEqual({ username: 'aldie' });
    });

    it('should throw a 404 HttpException when BGG returns an empty user element', async () => {
      mockHttpService.get.mockReturnValue(
        of({
          status: 200,
          data: '<user termsofuse="https://boardgamegeek.com/xmlapi/termsofuse"/>',
        }),
      );

      await expect(service.getUser('nonexistentuser')).rejects.toThrow(HttpException);
    });

    it('should not poll on a non-200 status — user is a synchronous endpoint', async () => {
      mockHttpService.get.mockReturnValue(of({ status: 500, data: '' }));

      await expect(service.getUser('aldie')).rejects.toThrow(HttpException);
      expect(mockHttpService.get).toHaveBeenCalledTimes(1);
    });
  });
```

Note: `getUser`'s implementation already exists from Task 1 (this refactor task wrote it ahead of its own tests, since it shared review with the internals refactor). This step's "run to verify it fails" is therefore skipped — go straight to running the tests to verify they pass.

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd apps/api && npx jest bgg.service.spec.ts -t getUser -v`
Expected: PASS (all 3 new tests).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bgg/bgg.service.spec.ts
git commit -m "test: cover BggService.getUser"
```

---

### Task 3: `BggService.getCollection`

**Files:**
- Modify: `apps/api/src/bgg/bgg.service.ts` (already implemented in Task 1)
- Test: `apps/api/src/bgg/bgg.service.spec.ts`

**Interfaces:**
- Produces: `BggService.getCollection(username: string): Promise<{ bggId: number; name: string }[]>`, used by `CollectionsService.importCollection` in Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/bgg/bgg.service.spec.ts`, after the `describe('getUser', ...)` block, at the top of the file alongside `VALID_XML` add these fixtures:

```typescript
const MULTI_ITEM_COLLECTION_XML = `
  <items totalitems="2">
    <item objecttype="thing" objectid="174430" subtype="boardgame">
      <name sortindex="1">Gloomhaven</name>
    </item>
    <item objecttype="thing" objectid="13" subtype="boardgame">
      <name sortindex="1">Catan</name>
    </item>
  </items>
`;

const SINGLE_ITEM_COLLECTION_XML = `
  <items totalitems="1">
    <item objecttype="thing" objectid="174430" subtype="boardgame">
      <name sortindex="1">Gloomhaven</name>
    </item>
  </items>
`;
```

Then add the test block:

```typescript
  describe('getCollection', () => {
    it('should return every owned game when BGG responds with 200', async () => {
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: MULTI_ITEM_COLLECTION_XML }),
      );

      const result = await service.getCollection('someuser');

      expect(result).toEqual([
        { bggId: 174430, name: 'Gloomhaven' },
        { bggId: 13, name: 'Catan' },
      ]);
    });

    it('should not wrap a single-item response in extra nesting', async () => {
      // fast-xml-parser returns items.item as a bare object (not an array)
      // when the collection has exactly one game — normalizeItems must
      // still produce a one-element array here, not throw or drop it.
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: SINGLE_ITEM_COLLECTION_XML }),
      );

      const result = await service.getCollection('someuser');

      expect(result).toEqual([{ bggId: 174430, name: 'Gloomhaven' }]);
    });

    it('should return an empty array for a user who owns nothing', async () => {
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: '<items totalitems="0"></items>' }),
      );

      const result = await service.getCollection('someuser');

      expect(result).toEqual([]);
    });

    it('should retry on 202 and resolve once BGG returns 200', async () => {
      mockHttpService.get
        .mockReturnValueOnce(of({ status: 202, data: '' }))
        .mockReturnValueOnce(of({ status: 200, data: SINGLE_ITEM_COLLECTION_XML }));

      const promise = service.getCollection('someuser');
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
      expect(result).toEqual([{ bggId: 174430, name: 'Gloomhaven' }]);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd apps/api && npx jest bgg.service.spec.ts -t getCollection -v`
Expected: PASS (all 4 new tests).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/bgg/bgg.service.spec.ts
git commit -m "test: cover BggService.getCollection"
```

---

### Task 4: `BggService.getGamesBatch`

**Files:**
- Modify: `apps/api/src/bgg/bgg.service.ts` (already implemented in Task 1)
- Test: `apps/api/src/bgg/bgg.service.spec.ts`

**Interfaces:**
- Produces: `BggService.getGamesBatch(bggIds: number[]): Promise<BggGame[]>`, used by `GamesService.findOrFetchMany` in Task 5.

- [ ] **Step 1: Write the failing tests**

Add this fixture near the top of `apps/api/src/bgg/bgg.service.spec.ts`, alongside `VALID_XML`:

```typescript
const MULTI_GAME_THING_XML = `
  <items>
    <item type="boardgame" id="174430">
      <thumbnail>//cf.geekdo-images.com/thumb1.jpg</thumbnail>
      <image>//cf.geekdo-images.com/image1.jpg</image>
      <name type="primary" sortindex="1" value="Gloomhaven"/>
      <description>A game of dungeon crawling.</description>
      <yearpublished value="2017"/>
      <minplayers value="1"/>
      <maxplayers value="4"/>
      <playingtime value="120"/>
      <statistics page="1">
        <ratings><average value="8.79"/></ratings>
      </statistics>
    </item>
    <item type="boardgame" id="13">
      <thumbnail>//cf.geekdo-images.com/thumb2.jpg</thumbnail>
      <image>//cf.geekdo-images.com/image2.jpg</image>
      <name type="primary" sortindex="1" value="Catan"/>
      <description>A game of trading and building.</description>
      <yearpublished value="1995"/>
      <minplayers value="3"/>
      <maxplayers value="4"/>
      <playingtime value="90"/>
      <statistics page="1">
        <ratings><average value="7.14"/></ratings>
      </statistics>
    </item>
  </items>
`;
```

Then add the test block:

```typescript
  describe('getGamesBatch', () => {
    it('should return an empty array without calling BGG when given no ids', async () => {
      const result = await service.getGamesBatch([]);

      expect(result).toEqual([]);
      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('should request all ids in one comma-separated call and parse every item', async () => {
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: MULTI_GAME_THING_XML }),
      );

      const result = await service.getGamesBatch([174430, 13]);

      expect(mockHttpService.get).toHaveBeenCalledTimes(1);
      expect(mockHttpService.get).toHaveBeenCalledWith(
        'https://boardgamegeek.com/xmlapi2/thing?id=174430,13&stats=1',
        { responseType: 'text' },
      );
      expect(result).toEqual<BggGame[]>([
        {
          bggId: 174430,
          name: 'Gloomhaven',
          description: 'A game of dungeon crawling.',
          thumbnail: '//cf.geekdo-images.com/thumb1.jpg',
          image: '//cf.geekdo-images.com/image1.jpg',
          minPlayers: 1,
          maxPlayers: 4,
          playingTime: 120,
          yearPublished: 2017,
          rating: 8.79,
        },
        {
          bggId: 13,
          name: 'Catan',
          description: 'A game of trading and building.',
          thumbnail: '//cf.geekdo-images.com/thumb2.jpg',
          image: '//cf.geekdo-images.com/image2.jpg',
          minPlayers: 3,
          maxPlayers: 4,
          playingTime: 90,
          yearPublished: 1995,
          rating: 7.14,
        },
      ]);
    });

    it('should still return a one-element array for a single requested id', async () => {
      // Same array-vs-object ambiguity as getCollection, exercised here for
      // the `thing` endpoint's response shape instead.
      mockHttpService.get.mockReturnValue(of({ status: 200, data: VALID_XML }));

      const result = await service.getGamesBatch([174430]);

      expect(result).toHaveLength(1);
      expect(result[0].bggId).toBe(174430);
    });

    it('should retry on 202 and resolve once BGG returns 200', async () => {
      mockHttpService.get
        .mockReturnValueOnce(of({ status: 202, data: '' }))
        .mockReturnValueOnce(of({ status: 200, data: MULTI_GAME_THING_XML }));

      const promise = service.getGamesBatch([174430, 13]);
      await jest.runAllTimersAsync();
      const result = await promise;

      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd apps/api && npx jest bgg.service.spec.ts -t getGamesBatch -v`
Expected: PASS (all 4 new tests).

- [ ] **Step 3: Run the full BggService suite one more time**

Run: `cd apps/api && npx jest bgg.service.spec.ts -v`
Expected: PASS, all tests across `getGame`, `getUser`, `getCollection`, `getGamesBatch`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/bgg/bgg.service.spec.ts
git commit -m "test: cover BggService.getGamesBatch"
```

---

### Task 5: `GamesService.findOrFetchMany` and `findByIds`

**Files:**
- Modify: `apps/api/src/games/games.service.ts`
- Test: `apps/api/src/games/games.service.spec.ts`

**Interfaces:**
- Consumes: `BggService.getGamesBatch(bggIds: number[]): Promise<BggGame[]>` (Task 4).
- Produces: `GamesService.findOrFetchMany(bggIds: number[]): Promise<Game[]>` and `GamesService.findByIds(ids: number[]): Promise<Game[]>`, both used by `CollectionsService` in Tasks 7-8.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/games/games.service.spec.ts`. First, update `mockGamesRepo` to add `findBy` (needed by both new methods):

```typescript
  const mockGamesRepo = {
    findOne: jest.fn(),
    findBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
```

And update `mockBggService` to add `getGamesBatch`:

```typescript
  const mockBggService = {
    getGame: jest.fn(),
    getGamesBatch: jest.fn(),
  };
```

Then add these `describe` blocks after the existing `describe('findOrFetch', ...)` block:

```typescript
  describe('findOrFetchMany', () => {
    it('should return an empty array without querying anything when given no ids', async () => {
      const result = await service.findOrFetchMany([]);

      expect(result).toEqual([]);
      expect(mockGamesRepo.findBy).not.toHaveBeenCalled();
    });

    it('should return cached games without calling BGG when every entry is fresh', async () => {
      const cached = [
        makeGame({ id: 1, bggId: 174430, lastFetchedAt: new Date() }),
        makeGame({ id: 2, bggId: 13, name: 'Catan', lastFetchedAt: new Date() }),
      ];
      mockGamesRepo.findBy.mockResolvedValue(cached);

      const result = await service.findOrFetchMany([174430, 13]);

      expect(result).toEqual(expect.arrayContaining(cached));
      expect(mockBggService.getGamesBatch).not.toHaveBeenCalled();
    });

    it('should batch-fetch only the stale or missing ids', async () => {
      // 174430 is fresh in cache; 13 is missing entirely.
      const freshGame = makeGame({ id: 1, bggId: 174430, lastFetchedAt: new Date() });
      mockGamesRepo.findBy.mockResolvedValue([freshGame]);

      const fetchedCatan: BggGame = {
        bggId: 13,
        name: 'Catan',
        description: 'A game of trading and building.',
        thumbnail: '//cf.geekdo-images.com/thumb2.jpg',
        image: '//cf.geekdo-images.com/image2.jpg',
        minPlayers: 3,
        maxPlayers: 4,
        playingTime: 90,
        yearPublished: 1995,
        rating: 7.14,
      };
      mockBggService.getGamesBatch.mockResolvedValue([fetchedCatan]);
      const savedCatan = makeGame({ id: 2, bggId: 13, name: 'Catan' });
      mockGamesRepo.create.mockReturnValue(savedCatan);
      mockGamesRepo.save.mockResolvedValue(savedCatan);

      const result = await service.findOrFetchMany([174430, 13]);

      expect(mockBggService.getGamesBatch).toHaveBeenCalledWith([13]);
      expect(result).toEqual(expect.arrayContaining([freshGame, savedCatan]));
    });

    it('should chunk more than 20 stale ids into multiple batch calls', async () => {
      mockGamesRepo.findBy.mockResolvedValue([]); // nothing cached
      const ids = Array.from({ length: 25 }, (_, i) => i + 1);
      mockBggService.getGamesBatch.mockResolvedValue([]);
      mockGamesRepo.create.mockReturnValue(makeGame());
      mockGamesRepo.save.mockResolvedValue(makeGame());

      await service.findOrFetchMany(ids);

      expect(mockBggService.getGamesBatch).toHaveBeenCalledTimes(2);
      expect(mockBggService.getGamesBatch).toHaveBeenNthCalledWith(
        1,
        ids.slice(0, 20),
      );
      expect(mockBggService.getGamesBatch).toHaveBeenNthCalledWith(
        2,
        ids.slice(20),
      );
    });
  });

  describe('findByIds', () => {
    it('should return an empty array without querying when given no ids', async () => {
      const result = await service.findByIds([]);

      expect(result).toEqual([]);
      expect(mockGamesRepo.findBy).not.toHaveBeenCalled();
    });

    it('should return games matching the given internal ids', async () => {
      const games = [makeGame({ id: 1 }), makeGame({ id: 2, bggId: 13 })];
      mockGamesRepo.findBy.mockResolvedValue(games);

      const result = await service.findByIds([1, 2]);

      expect(result).toEqual(games);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest games.service.spec.ts -v`
Expected: FAIL — `findOrFetchMany`/`findByIds` are not functions yet.

- [ ] **Step 3: Implement `findOrFetchMany` and `findByIds`**

In `apps/api/src/games/games.service.ts`, change the import line to add `In`:

```typescript
import { Repository, In } from 'typeorm';
```

Then add these two public methods to the `GamesService` class, after `findOrFetch`:

```typescript
  // Chunk size for BGG's thing?id=1,2,3 batch endpoint. Kept well under any
  // practical URL-length or response-size limit.
  private static readonly BATCH_CHUNK_SIZE = 20;

  // Same cache-freshness rule as findOrFetch, applied to a whole list at
  // once: games already fresh in cache never touch BGG. Only the
  // stale-or-missing subset is sent to BggService.getGamesBatch, chunked so
  // a large collection import doesn't build one enormous URL.
  async findOrFetchMany(bggIds: number[]): Promise<Game[]> {
    if (bggIds.length === 0) return [];

    const uniqueIds = [...new Set(bggIds)];
    const cached = await this.games.findBy({ bggId: In(uniqueIds) });
    const cachedByBggId = new Map(cached.map((g) => [g.bggId, g]));

    const staleOrMissing = uniqueIds.filter((id) => {
      const existing = cachedByBggId.get(id);
      return !existing || this.isStale(existing);
    });

    const fresh = uniqueIds
      .filter((id) => !staleOrMissing.includes(id))
      .map((id) => cachedByBggId.get(id)!);

    if (staleOrMissing.length === 0) return fresh;

    const refreshed: Game[] = [];
    for (let i = 0; i < staleOrMissing.length; i += GamesService.BATCH_CHUNK_SIZE) {
      const chunk = staleOrMissing.slice(i, i + GamesService.BATCH_CHUNK_SIZE);
      const bggData = await this.bgg.getGamesBatch(chunk);

      for (const data of bggData) {
        const existing = cachedByBggId.get(data.bggId);
        const game = this.games.create({
          ...existing, // carries over `id` and `createdAt` if row exists
          ...data,
          lastFetchedAt: new Date(),
        });
        refreshed.push(await this.games.save(game));
      }
    }

    return [...fresh, ...refreshed];
  }

  // Plain cache read by internal Game.id — no BGG involvement, no
  // freshness check. Used to look up games already known to be owned
  // (via GameOwnership rows), where triggering a live fetch would be
  // surprising for what's meant to be a simple listing read.
  async findByIds(ids: number[]): Promise<Game[]> {
    if (ids.length === 0) return [];
    return this.games.findBy({ id: In(ids) });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest games.service.spec.ts -v`
Expected: PASS, all tests including the new `findOrFetchMany`/`findByIds` blocks.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/games/games.service.ts apps/api/src/games/games.service.spec.ts
git commit -m "feat: add GamesService.findOrFetchMany and findByIds for batch collection import"
```

---

### Task 6: `BggAccount` and `GameOwnership` entities, schema update, apply to dev DB

**Files:**
- Create: `apps/api/src/collections/bgg-account.entity.ts`
- Create: `apps/api/src/collections/game-ownership.entity.ts`
- Modify: `db/schema.sql`

**Interfaces:**
- Produces: `BggAccount` (columns: `id`, `userId`, `bggUsername`, `linkedAt`) and `GameOwnership` (columns: `id`, `userId`, `gameId`, `addedAt`), both consumed by `CollectionsService` in Tasks 7-8.

This task has no application logic to TDD — it's schema and entity mapping, the same category of change as `Game`/`GroupMember`, neither of which has its own spec file. The testable deliverable is: the project builds, and the tables exist in the dev database.

- [ ] **Step 1: Create the `BggAccount` entity**

```typescript
// apps/api/src/collections/bgg-account.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('bgg_accounts') — one row per person who has linked a BGG
// username. userId is the raw Keycloak 'sub', stored as text, matching
// GroupMember.userId, AuditLog.actorId, and every other identity column in
// this codebase — there is no synced 'users' table to have a real FK into.
@Entity('bgg_accounts')
export class BggAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  // unique: true — one BGG link per person. Re-linking updates this row
  // rather than creating a second one.
  @Column({ name: 'user_id', unique: true })
  userId!: string;

  @Column({ name: 'bgg_username' })
  bggUsername!: string;

  // Set explicitly by CollectionsService.linkAccount on every link/re-link,
  // not @CreateDateColumn — a re-link (changing bggUsername) should update
  // this timestamp, and @CreateDateColumn only ever fires once, at INSERT.
  @Column({ name: 'linked_at' })
  linkedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
```

- [ ] **Step 2: Create the `GameOwnership` entity**

```typescript
// apps/api/src/collections/game-ownership.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('game_ownership') — join table between a person (raw Keycloak
// 'sub', same identity pattern as bgg_accounts.user_id above) and the
// shared 'games' catalogue. One row per game a user owns. The
// (user_id, game_id) uniqueness is enforced in db/schema.sql, the same way
// group_members' (user_id, group_id) uniqueness is — not via a TypeORM
// decorator, since nothing in this codebase relies on synchronize to create
// constraints (synchronize is false; schema.sql is applied by hand).
@Entity('game_ownership')
export class GameOwnership {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: string;

  // Bare column, not a @ManyToOne relation to Game — same "plain column, no
  // relation" choice GroupMember.groupId already made. Every query here is
  // "find this user's owned game ids" or "find owners of this game id";
  // neither needs TypeORM to eagerly load a full Game object through this row.
  @Column({ name: 'game_id' })
  gameId!: number;

  @CreateDateColumn({ name: 'added_at', type: 'date' })
  addedAt!: Date;
}
```

- [ ] **Step 3: Update `db/schema.sql`**

Replace the existing `-- ── GAME OWNERSHIP ──...` section (the one starting `CREATE TABLE IF NOT EXISTS game_ownership (`) with:

```sql
-- ── BGG ACCOUNTS ──────────────────────────────────────────────────────────
-- Backs the 'users.bgg_username' field sketched above — that field was
-- never actually built (this file's 'users' table never became a real
-- TypeORM entity, same as every other table here that originally assumed
-- one). user_id: raw Keycloak sub as TEXT, not an int FK to users(id),
-- matching group_members and everything else in this file.
-- Added for real by the BGG account linking & collection import feature
-- (docs/superpowers/specs/2026-08-20-bgg-account-linking-design.md).
CREATE TABLE IF NOT EXISTS bgg_accounts (
  id            SERIAL       PRIMARY KEY,
  user_id       TEXT         NOT NULL UNIQUE,
  bgg_username  TEXT         NOT NULL,
  linked_at     TIMESTAMPTZ  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── GAME OWNERSHIP ────────────────────────────────────────────────────────
-- Tracks which users personally own which games. A group's game library is
-- the union of its members' game_ownership rows — there is no separate
-- group_games table. Rows here come from a BGG collection import (see
-- bgg_accounts above) and are kept in sync on re-import: added when a game
-- newly appears in the user's BGG collection, removed when it no longer
-- does. Unlinking a bgg_accounts row does NOT delete these — they represent
-- real-world ownership, not BGG-link state.
-- user_id: TEXT, not an INT FK to users(id) as this table originally
-- sketched here — same drift-and-fix already applied to group_members
-- above; this schema's 'users' table was never built as a real entity.
CREATE TABLE IF NOT EXISTS game_ownership (
  id        SERIAL PRIMARY KEY,
  user_id   TEXT   NOT NULL,
  game_id   INT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at  DATE   NOT NULL DEFAULT CURRENT_DATE,

  UNIQUE (user_id, game_id)
);
```

- [ ] **Step 4: Verify the project still builds**

Run: `cd apps/api && npx nest build`
Expected: builds with no errors (confirms both new entities are valid TypeScript/decorator usage).

- [ ] **Step 5: Apply the new tables to the dev database**

Run:
```bash
docker compose -f docker-compose.dev.yml exec db \
  psql -U bggg -d bggg_dev -f /dev/stdin < db/schema.sql
```
Expected: `CREATE TABLE` (or a no-op skip for tables that already exist) printed for each table, including `bgg_accounts` and `game_ownership`, with no errors.

- [ ] **Step 6: Verify the tables exist**

Run:
```bash
docker compose -f docker-compose.dev.yml exec db \
  psql -U bggg -d bggg_dev -c "\d bgg_accounts" -c "\d game_ownership"
```
Expected: both `\d` commands print the column list matching the entities above.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/collections/bgg-account.entity.ts apps/api/src/collections/game-ownership.entity.ts db/schema.sql
git commit -m "feat: add BggAccount and GameOwnership entities"
```

---

### Task 7: `CollectionsService` — account link, unlink, read

**Files:**
- Create: `apps/api/src/collections/collections.service.ts`
- Create: `apps/api/src/collections/collections.service.spec.ts`

**Interfaces:**
- Consumes: `BggService.getUser` (Task 2), `GamesService.findByIds` (Task 5), `Repository<BggAccount>`, `Repository<GameOwnership>` (Task 6).
- Produces: `CollectionsService.getAccount(userId)`, `linkAccount(userId, bggUsername)`, `unlinkAccount(userId)`, `getOwnedGames(userId)` — `importCollection` is added in Task 8, in the same class.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/collections/collections.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BggService } from '../bgg/bgg.service';
import { GamesService } from '../games/games.service';
import { Game } from '../games/game.entity';
import { CollectionsService } from './collections.service';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 1,
    bggId: 174430,
    name: 'Gloomhaven',
    description: '',
    thumbnail: '',
    image: '',
    minPlayers: 1,
    maxPlayers: 4,
    playingTime: 120,
    yearPublished: 2017,
    rating: 8.79,
    lastFetchedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makeOwnership(overrides: Partial<GameOwnership> = {}): GameOwnership {
  return {
    id: 1,
    userId: 'user-1',
    gameId: 1,
    addedAt: new Date(),
    ...overrides,
  };
}

describe('CollectionsService', () => {
  let service: CollectionsService;

  const mockAccountsRepo = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockOwnershipRepo = {
    findBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockBggService = {
    getUser: jest.fn(),
    getCollection: jest.fn(),
  };

  const mockGamesService = {
    findOrFetchMany: jest.fn(),
    findByIds: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsService,
        { provide: getRepositoryToken(BggAccount), useValue: mockAccountsRepo },
        { provide: getRepositoryToken(GameOwnership), useValue: mockOwnershipRepo },
        { provide: BggService, useValue: mockBggService },
        { provide: GamesService, useValue: mockGamesService },
      ],
    }).compile();

    service = module.get<CollectionsService>(CollectionsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getAccount', () => {
    it('should return the linked account for this user', async () => {
      const account = { id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date() };
      mockAccountsRepo.findOneBy.mockResolvedValue(account);

      const result = await service.getAccount('user-1');

      expect(mockAccountsRepo.findOneBy).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(result).toEqual(account);
    });

    it('should return null when this user has no linked account', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue(null);

      const result = await service.getAccount('user-1');

      expect(result).toBeNull();
    });
  });

  describe('linkAccount', () => {
    it('should verify the username with BGG before saving', async () => {
      mockBggService.getUser.mockResolvedValue({ username: 'aldie' });
      mockAccountsRepo.findOneBy.mockResolvedValue(null);
      const saved = { id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date() };
      mockAccountsRepo.create.mockReturnValue(saved);
      mockAccountsRepo.save.mockResolvedValue(saved);

      const result = await service.linkAccount('user-1', 'aldie');

      expect(mockBggService.getUser).toHaveBeenCalledWith('aldie');
      expect(result).toEqual(saved);
    });

    it('should propagate the error and never save when BGG rejects the username', async () => {
      mockBggService.getUser.mockRejectedValue(new Error('not found'));

      await expect(service.linkAccount('user-1', 'nonexistentuser')).rejects.toThrow();

      expect(mockAccountsRepo.save).not.toHaveBeenCalled();
    });

    it('should update the existing row (not insert a second one) when re-linking', async () => {
      mockBggService.getUser.mockResolvedValue({ username: 'newname' });
      const existing = { id: 7, userId: 'user-1', bggUsername: 'oldname', linkedAt: new Date(), createdAt: new Date() };
      mockAccountsRepo.findOneBy.mockResolvedValue(existing);
      mockAccountsRepo.create.mockImplementation((data) => data);
      mockAccountsRepo.save.mockImplementation((data) => Promise.resolve(data));

      await service.linkAccount('user-1', 'newname');

      expect(mockAccountsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: 7, bggUsername: 'newname' }),
      );
    });
  });

  describe('unlinkAccount', () => {
    it('should delete the account link but never touch ownership rows', async () => {
      await service.unlinkAccount('user-1');

      expect(mockAccountsRepo.delete).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(mockOwnershipRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('getOwnedGames', () => {
    it('should return an empty array when the user owns nothing', async () => {
      mockOwnershipRepo.findBy.mockResolvedValue([]);

      const result = await service.getOwnedGames('user-1');

      expect(result).toEqual([]);
      expect(mockGamesService.findByIds).not.toHaveBeenCalled();
    });

    it('should look up games by the internal ids from ownership rows', async () => {
      const ownership = [makeOwnership({ gameId: 1 }), makeOwnership({ gameId: 2 })];
      mockOwnershipRepo.findBy.mockResolvedValue(ownership);
      const games = [makeGame({ id: 1 }), makeGame({ id: 2, bggId: 13 })];
      mockGamesService.findByIds.mockResolvedValue(games);

      const result = await service.getOwnedGames('user-1');

      expect(mockGamesService.findByIds).toHaveBeenCalledWith([1, 2]);
      expect(result).toEqual(games);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest collections.service.spec.ts -v`
Expected: FAIL — `CollectionsService` doesn't exist yet.

- [ ] **Step 3: Implement `CollectionsService` (link/unlink/read portion)**

```typescript
// apps/api/src/collections/collections.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BggService } from '../bgg/bgg.service';
import { GamesService } from '../games/games.service';
import { Game } from '../games/game.entity';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';

export interface ImportSummary {
  added: number;
  removed: number;
  total: number;
}

@Injectable()
export class CollectionsService {
  constructor(
    @InjectRepository(BggAccount)
    private readonly accounts: Repository<BggAccount>,
    @InjectRepository(GameOwnership)
    private readonly ownership: Repository<GameOwnership>,
    private readonly bgg: BggService,
    private readonly games: GamesService,
  ) {}

  async getAccount(userId: string): Promise<BggAccount | null> {
    return this.accounts.findOneBy({ userId });
  }

  // Verifies the username exists on BGG before saving — this can't prove
  // ownership (BGG has no such mechanism for third parties), only that the
  // username isn't a typo pointing nowhere.
  async linkAccount(userId: string, bggUsername: string): Promise<BggAccount> {
    await this.bgg.getUser(bggUsername);

    const existing = await this.accounts.findOneBy({ userId });
    const account = this.accounts.create({
      ...existing, // carries over `id` if a link already exists, so this is an UPDATE
      userId,
      bggUsername,
      linkedAt: new Date(),
    });

    return this.accounts.save(account);
  }

  // Ownership rows are deliberately left untouched — they represent
  // real-world ownership recorded by a past import, not BGG-link state.
  async unlinkAccount(userId: string): Promise<void> {
    await this.accounts.delete({ userId });
  }

  async getOwnedGames(userId: string): Promise<Game[]> {
    const rows = await this.ownership.findBy({ userId });
    if (rows.length === 0) return [];

    return this.games.findByIds(rows.map((row) => row.gameId));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest collections.service.spec.ts -v`
Expected: PASS for `getAccount`, `linkAccount`, `unlinkAccount`, `getOwnedGames` (the `importCollection` tests from Task 8 don't exist yet).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/collections/collections.service.ts apps/api/src/collections/collections.service.spec.ts
git commit -m "feat: add CollectionsService account linking and read operations"
```

---

### Task 8: `CollectionsService.importCollection`

**Files:**
- Modify: `apps/api/src/collections/collections.service.ts`
- Modify: `apps/api/src/collections/collections.service.spec.ts`

**Interfaces:**
- Consumes: `BggService.getCollection` (Task 3), `GamesService.findOrFetchMany` (Task 5).
- Produces: `CollectionsService.importCollection(userId: string): Promise<ImportSummary>`, used by `CollectionsController` in Task 9.

This is the highest-value test surface in this feature per the spec — pure diff logic against mocked collaborators.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/collections/collections.service.spec.ts`, after the `describe('getOwnedGames', ...)` block:

```typescript
  describe('importCollection', () => {
    it('should throw a 400 when this user has no linked account', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue(null);

      await expect(service.importCollection('user-1')).rejects.toThrow(BadRequestException);
    });

    it('should add ownership rows for newly-owned games and report the summary', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({
        id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date(),
      });
      mockBggService.getCollection.mockResolvedValue([
        { bggId: 174430, name: 'Gloomhaven' },
        { bggId: 13, name: 'Catan' },
      ]);
      mockGamesService.findOrFetchMany.mockResolvedValue([
        makeGame({ id: 1, bggId: 174430 }),
        makeGame({ id: 2, bggId: 13, name: 'Catan' }),
      ]);
      mockOwnershipRepo.findBy.mockResolvedValue([]); // no prior ownership
      mockOwnershipRepo.create.mockImplementation((data) => data);
      mockOwnershipRepo.save.mockResolvedValue(undefined);

      const result = await service.importCollection('user-1');

      expect(mockGamesService.findOrFetchMany).toHaveBeenCalledWith([174430, 13]);
      expect(mockOwnershipRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'user-1', gameId: 1 }),
        expect.objectContaining({ userId: 'user-1', gameId: 2 }),
      ]);
      expect(mockOwnershipRepo.delete).not.toHaveBeenCalled();
      expect(result).toEqual({ added: 2, removed: 0, total: 2 });
    });

    it('should remove ownership rows for games no longer in the BGG collection', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({
        id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date(),
      });
      // BGG collection now only has Gloomhaven (game id 1).
      mockBggService.getCollection.mockResolvedValue([{ bggId: 174430, name: 'Gloomhaven' }]);
      mockGamesService.findOrFetchMany.mockResolvedValue([makeGame({ id: 1, bggId: 174430 })]);
      // Previously owned games 1 (Gloomhaven) AND 2 (Catan, id 5 ownership row).
      mockOwnershipRepo.findBy.mockResolvedValue([
        makeOwnership({ id: 10, gameId: 1 }),
        makeOwnership({ id: 11, gameId: 2 }),
      ]);

      const result = await service.importCollection('user-1');

      expect(mockOwnershipRepo.save).not.toHaveBeenCalled(); // nothing new to add
      expect(mockOwnershipRepo.delete).toHaveBeenCalledWith({ id: In([11]) });
      expect(result).toEqual({ added: 0, removed: 1, total: 1 });
    });

    it('should both add and remove in the same import when the collection changed both ways', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({
        id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date(),
      });
      // Now owns Catan (game id 2) only; previously owned Gloomhaven (game id 1).
      mockBggService.getCollection.mockResolvedValue([{ bggId: 13, name: 'Catan' }]);
      mockGamesService.findOrFetchMany.mockResolvedValue([makeGame({ id: 2, bggId: 13, name: 'Catan' })]);
      mockOwnershipRepo.findBy.mockResolvedValue([makeOwnership({ id: 10, gameId: 1 })]);
      mockOwnershipRepo.create.mockImplementation((data) => data);
      mockOwnershipRepo.save.mockResolvedValue(undefined);

      const result = await service.importCollection('user-1');

      expect(mockOwnershipRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'user-1', gameId: 2 }),
      ]);
      expect(mockOwnershipRepo.delete).toHaveBeenCalledWith({ id: In([10]) });
      expect(result).toEqual({ added: 1, removed: 1, total: 1 });
    });

    it('should report a valid empty sync for a collection with zero owned games', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({
        id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date(),
      });
      mockBggService.getCollection.mockResolvedValue([]);
      mockGamesService.findOrFetchMany.mockResolvedValue([]);
      mockOwnershipRepo.findBy.mockResolvedValue([makeOwnership({ id: 10, gameId: 1 })]);

      const result = await service.importCollection('user-1');

      expect(mockOwnershipRepo.delete).toHaveBeenCalledWith({ id: In([10]) });
      expect(result).toEqual({ added: 0, removed: 1, total: 0 });
    });
  });
```

Add the `In` import to the top of the spec file:

```typescript
import { In } from 'typeorm';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest collections.service.spec.ts -t importCollection -v`
Expected: FAIL — `importCollection` is not a function yet.

- [ ] **Step 3: Implement `importCollection`**

Add to the `CollectionsService` class in `apps/api/src/collections/collections.service.ts`, after `unlinkAccount`:

```typescript
  async importCollection(userId: string): Promise<ImportSummary> {
    const account = await this.accounts.findOneBy({ userId });
    if (!account) {
      throw new BadRequestException('No BGG account linked');
    }

    const collection = await this.bgg.getCollection(account.bggUsername);
    const bggIds = collection.map((item) => item.bggId);

    // Hydrates/refreshes the shared catalogue so every currently-owned game
    // has a Game row to point at before ownership rows are touched.
    const hydratedGames = await this.games.findOrFetchMany(bggIds);
    const gameIdByBggId = new Map(hydratedGames.map((g) => [g.bggId, g.id]));
    const currentGameIds = new Set(
      bggIds
        .map((id) => gameIdByBggId.get(id))
        .filter((id): id is number => id !== undefined),
    );

    const existingOwnership = await this.ownership.findBy({ userId });
    const existingGameIds = new Set(existingOwnership.map((row) => row.gameId));

    const toAdd = [...currentGameIds].filter((gameId) => !existingGameIds.has(gameId));
    const toRemove = existingOwnership.filter((row) => !currentGameIds.has(row.gameId));

    if (toAdd.length > 0) {
      await this.ownership.save(
        toAdd.map((gameId) => this.ownership.create({ userId, gameId })),
      );
    }

    if (toRemove.length > 0) {
      await this.ownership.delete({ id: In(toRemove.map((row) => row.id)) });
    }

    return { added: toAdd.length, removed: toRemove.length, total: currentGameIds.size };
  }
```

`In` is already imported at the top of `collections.service.ts` from Task 7's `import { In, Repository } from 'typeorm';` — no import change needed here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx jest collections.service.spec.ts -v`
Expected: PASS, the full `CollectionsService` suite.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/collections/collections.service.ts apps/api/src/collections/collections.service.spec.ts
git commit -m "feat: add CollectionsService.importCollection with add/remove sync"
```

---

### Task 9: `CollectionsController`, DTO, `CollectionsModule`, and `AppModule` registration

**Files:**
- Create: `apps/api/src/collections/dto/link-bgg-account.dto.ts`
- Create: `apps/api/src/collections/collections.controller.ts`
- Create: `apps/api/src/collections/collections.controller.spec.ts`
- Create: `apps/api/src/collections/collections.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `CollectionsService` (Tasks 7-8), `AuthGuard` (existing).
- Produces: `POST/GET/DELETE /bgg-account`, `POST /bgg-account/import`, `GET /bgg-account/games`.

- [ ] **Step 1: Write the failing controller tests**

```typescript
// apps/api/src/collections/collections.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

const alwaysAllowGuard = { canActivate: () => true };
const fakeRequest = { user: { sub: 'user-1' } };

describe('CollectionsController', () => {
  let controller: CollectionsController;

  const mockCollectionsService = {
    getAccount: jest.fn(),
    linkAccount: jest.fn(),
    unlinkAccount: jest.fn(),
    importCollection: jest.fn(),
    getOwnedGames: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CollectionsController],
      providers: [
        { provide: CollectionsService, useValue: mockCollectionsService },
        { provide: APP_GUARD, useValue: alwaysAllowGuard },
      ],
    }).compile();

    controller = module.get<CollectionsController>(CollectionsController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getAccount', () => {
    it('should call the service with the requesting user id', async () => {
      mockCollectionsService.getAccount.mockResolvedValue(null);

      await controller.getAccount(fakeRequest as any);

      expect(mockCollectionsService.getAccount).toHaveBeenCalledWith('user-1');
    });
  });

  describe('linkAccount', () => {
    it('should call the service with the user id and the dto username', async () => {
      const dto = { bggUsername: 'aldie' };
      mockCollectionsService.linkAccount.mockResolvedValue({ id: 1 });

      await controller.linkAccount(dto as any, fakeRequest as any);

      expect(mockCollectionsService.linkAccount).toHaveBeenCalledWith('user-1', 'aldie');
    });
  });

  describe('unlinkAccount', () => {
    it('should call the service with the requesting user id', async () => {
      await controller.unlinkAccount(fakeRequest as any);

      expect(mockCollectionsService.unlinkAccount).toHaveBeenCalledWith('user-1');
    });
  });

  describe('importCollection', () => {
    it('should call the service with the requesting user id', async () => {
      mockCollectionsService.importCollection.mockResolvedValue({ added: 0, removed: 0, total: 0 });

      await controller.importCollection(fakeRequest as any);

      expect(mockCollectionsService.importCollection).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getOwnedGames', () => {
    it('should call the service with the requesting user id', async () => {
      mockCollectionsService.getOwnedGames.mockResolvedValue([]);

      await controller.getOwnedGames(fakeRequest as any);

      expect(mockCollectionsService.getOwnedGames).toHaveBeenCalledWith('user-1');
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx jest collections.controller.spec.ts -v`
Expected: FAIL — none of these files exist yet.

- [ ] **Step 3: Create the DTO**

```typescript
// apps/api/src/collections/dto/link-bgg-account.dto.ts
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LinkBggAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  bggUsername!: string;
}
```

- [ ] **Step 4: Create the controller**

```typescript
// apps/api/src/collections/collections.controller.ts
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  HttpCode,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { LinkBggAccountDto } from './dto/link-bgg-account.dto';
import { AuthGuard } from '../auth/auth.guard';

// Same local-interface convention every other controller in this repo uses
// (GroupsController, InvitesController, UploadsController, ...) instead of
// a shared type — these handlers only ever touch req.user.sub.
interface AuthenticatedRequest {
  user: { sub: string };
}

@UseGuards(AuthGuard)
@Controller('bgg-account')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  // GET /bgg-account → the current link, or null if none
  @Get()
  getAccount(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.getAccount(req.user.sub);
  }

  // POST /bgg-account → 200 OK, upserts the link (create or re-link)
  @Post()
  @HttpCode(200)
  linkAccount(@Body() dto: LinkBggAccountDto, @Request() req: AuthenticatedRequest) {
    return this.collectionsService.linkAccount(req.user.sub, dto.bggUsername);
  }

  // DELETE /bgg-account → 204 No Content. GameOwnership rows are kept.
  @Delete()
  @HttpCode(204)
  async unlinkAccount(@Request() req: AuthenticatedRequest) {
    await this.collectionsService.unlinkAccount(req.user.sub);
  }

  // POST /bgg-account/import → 200 OK with { added, removed, total }
  @Post('import')
  @HttpCode(200)
  importCollection(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.importCollection(req.user.sub);
  }

  // GET /bgg-account/games → this user's owned games, joined with Game data
  @Get('games')
  getOwnedGames(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.getOwnedGames(req.user.sub);
  }
}
```

- [ ] **Step 5: Create the module**

```typescript
// apps/api/src/collections/collections.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { BggModule } from '../bgg/bgg.module';
import { GamesModule } from '../games/games.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BggAccount, GameOwnership]),
    // BggModule exports BggService (username verification + collection
    // fetching); GamesModule exports GamesService (catalogue hydration).
    BggModule,
    GamesModule,
  ],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
```

- [ ] **Step 6: Register `CollectionsModule` in `AppModule`**

In `apps/api/src/app.module.ts`, add the import:

```typescript
import { CollectionsModule } from './collections/collections.module';
```

And add `CollectionsModule` to the `imports` array (after `GamesModule`):

```typescript
    AuditModule,
    GroupsModule,
    GamesModule,
    CollectionsModule,
    ChatModule,
    UploadsModule,
    InvitesModule,
    SchedulingModule,
    CalendarModule,
```

- [ ] **Step 7: Run the controller tests to verify they pass**

Run: `cd apps/api && npx jest collections.controller.spec.ts -v`
Expected: PASS, all 5 tests.

- [ ] **Step 8: Run the full test suite and build**

Run: `cd apps/api && npx jest && npx nest build`
Expected: every test in the project passes, and the build succeeds (confirms `AppModule` wiring is valid — a missing provider or circular dependency would throw here).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/collections/dto/link-bgg-account.dto.ts apps/api/src/collections/collections.controller.ts apps/api/src/collections/collections.controller.spec.ts apps/api/src/collections/collections.module.ts apps/api/src/app.module.ts
git commit -m "feat: expose BGG account linking and collection import via /bgg-account"
```

---

## After This Plan

- Manually exercise the new endpoints against a real BGG username (e.g. `curl` with a real JWT) to confirm the live 202-polling and batch-fetch paths behave as the mocked tests predict — the spec's tests never hit the real BGG API.
- Refresh `docs/reference/bgg-integration.md`'s "Extension points" section with the final method signatures once implementation is done, and mirror it to the attached Plane page (`page create` with the same name + new content, `attach_to_workitem`, then `detach_from_workitem` the stale version) as part of closing out the feature work item.
