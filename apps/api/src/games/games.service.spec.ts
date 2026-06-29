import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BggService, BggGame } from '../bgg/bgg.service';
import { GamesService } from './games.service';
import { Game } from './game.entity';

// Reusable fixture — the BGG data that BggService would return.
const BGG_DATA: BggGame = {
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
};

// Builds a minimal Game entity for use in tests, with sensible defaults.
// Passing `overrides` lets each test set only the fields it cares about.
function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 1,
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
    lastFetchedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('GamesService', () => {
  let service: GamesService;

  const mockGamesRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockBggService = {
    getGame: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GamesService,
        {
          provide: getRepositoryToken(Game),
          useValue: mockGamesRepo,
        },
        {
          // Provide BggService by its class token — same pattern as HttpService
          // in the BggService tests. GamesService injects BggService by type.
          provide: BggService,
          useValue: mockBggService,
        },
      ],
    }).compile();

    service = module.get<GamesService>(GamesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findOrFetch', () => {

    // ── cache hit (fresh) ─────────────────────────────────────────────────

    it('should return the cached game without calling BGG when the cache is fresh', async () => {
      // lastFetchedAt = now → well within the 7-day TTL.
      const cachedGame = makeGame({ lastFetchedAt: new Date() });
      mockGamesRepo.findOne.mockResolvedValue(cachedGame);

      const result = await service.findOrFetch(174430);

      expect(result).toEqual(cachedGame);
      // The whole point of caching: BGG must not be called for a fresh entry.
      expect(mockBggService.getGame).not.toHaveBeenCalled();
      expect(mockGamesRepo.save).not.toHaveBeenCalled();
    });

    // ── cache miss ────────────────────────────────────────────────────────

    it('should fetch from BGG and persist a new row when no cache entry exists', async () => {
      const savedGame = makeGame();
      mockGamesRepo.findOne.mockResolvedValue(null); // no row in DB
      mockBggService.getGame.mockResolvedValue(BGG_DATA);
      mockGamesRepo.create.mockReturnValue(savedGame); // create() is sync
      mockGamesRepo.save.mockResolvedValue(savedGame);

      const result = await service.findOrFetch(174430);

      expect(mockBggService.getGame).toHaveBeenCalledWith(174430);
      expect(mockGamesRepo.save).toHaveBeenCalledTimes(1);
      expect(result).toEqual(savedGame);
    });

    it('should pass lastFetchedAt to create() when inserting a new row', async () => {
      mockGamesRepo.findOne.mockResolvedValue(null);
      mockBggService.getGame.mockResolvedValue(BGG_DATA);
      mockGamesRepo.create.mockReturnValue(makeGame());
      mockGamesRepo.save.mockResolvedValue(makeGame());

      await service.findOrFetch(174430);

      // lastFetchedAt must be set — without it, isStale() would throw on the
      // next request because lastFetchedAt.getTime() would be undefined.
      expect(mockGamesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ lastFetchedAt: expect.any(Date) }),
      );
    });

    // ── cache hit (stale) ─────────────────────────────────────────────────

    it('should re-fetch from BGG and update the existing row when the cache is stale', async () => {
      // 8 days ago — past the 7-day TTL.
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const staleGame = makeGame({ id: 5, name: 'Old Name', lastFetchedAt: eightDaysAgo });
      const refreshedGame = makeGame({ id: 5, name: 'Gloomhaven' });

      mockGamesRepo.findOne.mockResolvedValue(staleGame);
      mockBggService.getGame.mockResolvedValue(BGG_DATA);
      mockGamesRepo.create.mockReturnValue(refreshedGame);
      mockGamesRepo.save.mockResolvedValue(refreshedGame);

      const result = await service.findOrFetch(174430);

      expect(mockBggService.getGame).toHaveBeenCalledWith(174430);

      // The stale row's `id` must be spread into create() so TypeORM issues
      // an UPDATE (existing id) rather than a second INSERT (no id).
      expect(mockGamesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ id: 5 }),
      );

      expect(result.name).toBe('Gloomhaven');
    });
  });
});
