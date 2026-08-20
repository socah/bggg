import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
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
});
