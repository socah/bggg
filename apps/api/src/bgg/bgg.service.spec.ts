import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { BggService, BggGame } from './bgg.service';

// Minimal BGG XML fixture — only the fields BggService actually reads.
// A real BGG response has dozens of extra elements; we strip them here so the
// test stays focused on our parsing logic, not BGG's full schema.
const VALID_XML = `
  <items>
    <item type="boardgame" id="174430">
      <thumbnail>//cf.geekdo-images.com/thumb.jpg</thumbnail>
      <image>//cf.geekdo-images.com/image.jpg</image>
      <name type="primary" sortindex="1" value="Gloomhaven"/>
      <name type="alternate" sortindex="1" value="Gloomhaven Alt"/>
      <description>A game of dungeon crawling.</description>
      <yearpublished value="2017"/>
      <minplayers value="1"/>
      <maxplayers value="4"/>
      <playingtime value="120"/>
      <statistics page="1">
        <ratings>
          <average value="8.79"/>
        </ratings>
      </statistics>
    </item>
  </items>
`;

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

describe('BggService', () => {
  let service: BggService;

  const mockHttpService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    // Replace real timers with Jest-controlled fakes so setTimeout resolves
    // instantly when we call jest.runAllTimersAsync(). Without this, the 202
    // retry test would actually pause for 2 seconds per attempt.
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BggService,
        {
          // Provide a mock HttpService using the class itself as the DI token.
          // BggService injects HttpService by type, so the token must match.
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<BggService>(BggService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ── getGame: happy path ───────────────────────────────────────────────────

  describe('getGame', () => {
    it('should return parsed game data when BGG responds with 200', async () => {
      // of() creates an Observable that emits one value immediately then completes.
      // This is the RxJS equivalent of Promise.resolve() — firstValueFrom() in the
      // service subscribes, gets this value, and resolves.
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: VALID_XML }),
      );

      const result = await service.getGame(174430);

      expect(result).toEqual<BggGame>({
        bggId: 174430,
        name: 'Gloomhaven',
        description: 'A game of dungeon crawling.',
        thumbnail: '//cf.geekdo-images.com/thumb.jpg',
        image: '//cf.geekdo-images.com/image.jpg',
        minPlayers: 1,
        maxPlayers: 4,
        playingTime: 120,
        yearPublished: 2017,
        rating: 8.79,
      });
    });

    it('should use the primary name, not the alternate', async () => {
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: VALID_XML }),
      );

      const result = await service.getGame(174430);

      // The fixture has both a primary and an alternate name.
      // parseGame must pick the one with type="primary".
      expect(result.name).toBe('Gloomhaven');
      expect(result.name).not.toBe('Gloomhaven Alt');
    });

    // ── polling ─────────────────────────────────────────────────────────────

    it('should retry on 202 and resolve once BGG returns 200', async () => {
      // First call returns 202 (BGG not ready); second returns 200 with data.
      mockHttpService.get
        .mockReturnValueOnce(of({ status: 202, data: '' }))
        .mockReturnValueOnce(of({ status: 200, data: VALID_XML }));

      // Start the call but don't await yet — it is paused at the sleep() call.
      const promise = service.getGame(174430);

      // Advance all pending setTimeout calls to completion. This resolves the
      // sleep() inside the retry loop, allowing the second HTTP call to proceed.
      await jest.runAllTimersAsync();

      const result = await promise;

      expect(mockHttpService.get).toHaveBeenCalledTimes(2);
      expect(result.name).toBe('Gloomhaven');
    });

    it('should throw 504 after exhausting all retries', async () => {
      // Always returns 202 — BGG never becomes ready.
      mockHttpService.get.mockReturnValue(of({ status: 202, data: '' }));

      const promise = service.getGame(174430);

      // Attach the rejection handler BEFORE advancing timers. If we advanced
      // timers first, the promise would reject during runAllTimersAsync and
      // Node would briefly see an unhandled rejection before rejects.toThrow
      // could attach its handler. Setting up the assertion first closes that window.
      const assertion = expect(promise).rejects.toThrow(HttpException);
      await jest.runAllTimersAsync();
      await assertion;

      // maxRetries is 5 — the service should stop after exactly 5 attempts.
      expect(mockHttpService.get).toHaveBeenCalledTimes(5);
    });

    // ── error handling ───────────────────────────────────────────────────────

    it('should throw HttpException immediately on an unexpected status code', async () => {
      mockHttpService.get.mockReturnValue(of({ status: 500, data: '' }));

      // No timer advance needed — an unexpected status throws without sleeping.
      await expect(service.getGame(174430)).rejects.toThrow(HttpException);

      // Should have given up after the first call, not retried.
      expect(mockHttpService.get).toHaveBeenCalledTimes(1);
    });
  });

  // ── getUser ──────────────────────────────────────────────────────────────

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

  // ── getCollection ────────────────────────────────────────────────────────

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
});
