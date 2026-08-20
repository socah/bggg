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
