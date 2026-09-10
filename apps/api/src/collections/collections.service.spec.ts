import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { BggService } from '../bgg/bgg.service';
import { GamesService } from '../games/games.service';
import { Game } from '../games/game.entity';
import { CollectionsService } from './collections.service';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';
import { GameWishlist } from './game-wishlist.entity';
import { GameSaved } from './game-saved.entity';
import { Review } from './review.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';
import { PlaySession } from '../scheduling/play-session.entity';
import { PlaySessionGame } from '../scheduling/play-session-game.entity';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
import { PersonalList } from './personal-list.entity';
import { PersonalListItem } from './personal-list-item.entity';

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
    source: 'bgg',
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

  // importCollection's add/remove run inside ownership.manager.transaction(),
  // so the writes land on the transaction's EntityManager rather than on the
  // repository. mockTransactionManager stands in for that manager; the mock
  // transaction() simply invokes the callback with it, which is enough to
  // assert what would have been written inside the transaction.
  const mockTransactionManager = {
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockOwnershipRepo = {
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    manager: {
      transaction: jest.fn((cb: (m: typeof mockTransactionManager) => Promise<unknown>) =>
        cb(mockTransactionManager),
      ),
    },
  };

  const mockWishlistRepo = {
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const mockSavedRepo = {
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const mockReviewsRepo = {
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    remove: jest.fn(),
  };
  const mockListsRepo = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };
  const mockListItemsRepo = {
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };
  const emptyRepo = {
    findBy: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockBggService = {
    getUser: jest.fn(),
    getCollection: jest.fn(),
    getWishlist: jest.fn(),
    searchGames: jest.fn(),
  };

  const mockGamesService = {
    findOrFetchMany: jest.fn(),
    findCachedByBggIds: jest.fn(),
    findByIds: jest.fn(),
    findOrFetch: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollectionsService,
        { provide: getRepositoryToken(BggAccount), useValue: mockAccountsRepo },
        { provide: getRepositoryToken(GameOwnership), useValue: mockOwnershipRepo },
        { provide: getRepositoryToken(GameWishlist), useValue: mockWishlistRepo },
        { provide: getRepositoryToken(GameSaved), useValue: mockSavedRepo },
        { provide: getRepositoryToken(Review), useValue: mockReviewsRepo },
        { provide: getRepositoryToken(PersonalList), useValue: mockListsRepo },
        { provide: getRepositoryToken(PersonalListItem), useValue: mockListItemsRepo },
        { provide: getRepositoryToken(GroupMember), useValue: emptyRepo },
        { provide: getRepositoryToken(Group), useValue: emptyRepo },
        { provide: getRepositoryToken(PlaySession), useValue: emptyRepo },
        { provide: getRepositoryToken(PlaySessionGame), useValue: emptyRepo },
        { provide: BggService, useValue: mockBggService },
        { provide: GamesService, useValue: mockGamesService },
        { provide: KeycloakAdminClient, useValue: { getUser: jest.fn() } },
      ],
    }).compile();

    service = module.get<CollectionsService>(CollectionsService);
    mockBggService.getWishlist.mockResolvedValue([]);
    mockWishlistRepo.findBy.mockResolvedValue([]);
    mockSavedRepo.findBy.mockResolvedValue([]);
    mockReviewsRepo.findBy.mockResolvedValue([]);
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

    it("should store BGG's canonical username, not the client's spelling", async () => {
      // BGG matches usernames case-insensitively and echoes back the real one.
      mockBggService.getUser.mockResolvedValue({ username: 'aldie' });
      mockAccountsRepo.findOneBy.mockResolvedValue(null);
      mockAccountsRepo.create.mockImplementation((data) => data);
      mockAccountsRepo.save.mockImplementation((data) => Promise.resolve(data));

      const result = await service.linkAccount('user-1', 'ALDIE');

      expect(mockBggService.getUser).toHaveBeenCalledWith('ALDIE');
      expect(mockAccountsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ bggUsername: 'aldie' }),
      );
      expect(result).toEqual(expect.objectContaining({ bggUsername: 'aldie' }));
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
      expect(result).toEqual([
        expect.objectContaining({ ...games[0], source: 'bgg', addedAt: ownership[0].addedAt }),
        expect.objectContaining({ ...games[1], source: 'bgg', addedAt: ownership[1].addedAt }),
      ]);
    });
  });

  describe('BGG-managed membership changes', () => {
    it('rejects removing BGG-owned games locally', async () => {
      mockOwnershipRepo.findOneBy.mockResolvedValue(makeOwnership({ source: 'bgg' }));

      await expect(service.removeOwnedGame('user-1', 1)).rejects.toThrow(/BoardGameGeek.*sync/);
      expect(mockOwnershipRepo.delete).not.toHaveBeenCalled();
    });

    it('allows removing manually added owned games without deleting the catalogue game', async () => {
      mockOwnershipRepo.findOneBy.mockResolvedValue(makeOwnership({ source: 'manual' }));

      await service.removeOwnedGame('user-1', 1);

      expect(mockOwnershipRepo.delete).toHaveBeenCalledWith({ userId: 'user-1', gameId: 1 });
      expect(mockGamesService.findByIds).not.toHaveBeenCalled();
    });

    it('rejects removing BGG wishlist games locally', async () => {
      mockWishlistRepo.findOneBy.mockResolvedValue({ source: 'bgg' });

      await expect(service.removeWishlistGame('user-1', 1)).rejects.toThrow(/BoardGameGeek.*sync/);
      expect(mockWishlistRepo.delete).not.toHaveBeenCalled();
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
      mockTransactionManager.create.mockImplementation((_entity, data) => data);
      mockTransactionManager.save.mockResolvedValue(undefined);

      const result = await service.importCollection('user-1');

      expect(mockGamesService.findOrFetchMany).toHaveBeenCalledWith([174430, 13]);
      expect(mockOwnershipRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(mockTransactionManager.save).toHaveBeenCalledWith(GameOwnership, [
        expect.objectContaining({ userId: 'user-1', gameId: 1 }),
        expect.objectContaining({ userId: 'user-1', gameId: 2 }),
      ]);
      expect(mockTransactionManager.delete).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ added: 2, removed: 0, total: 2 }));
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

      expect(mockTransactionManager.save).toHaveBeenCalledWith(GameOwnership, [
        expect.objectContaining({ id: 10, userId: 'user-1', gameId: 1, source: 'bgg' }),
      ]);
      expect(mockTransactionManager.delete).toHaveBeenCalledWith(GameOwnership, {
        id: In([11]),
      });
      expect(result).toEqual(expect.objectContaining({ added: 0, removed: 1, total: 1 }));
    });

    it('should both add and remove in the same import when the collection changed both ways', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({
        id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date(),
      });
      // Now owns Catan (game id 2) only; previously owned Gloomhaven (game id 1).
      mockBggService.getCollection.mockResolvedValue([{ bggId: 13, name: 'Catan' }]);
      mockGamesService.findOrFetchMany.mockResolvedValue([makeGame({ id: 2, bggId: 13, name: 'Catan' })]);
      mockOwnershipRepo.findBy.mockResolvedValue([makeOwnership({ id: 10, gameId: 1 })]);
      mockTransactionManager.create.mockImplementation((_entity, data) => data);
      mockTransactionManager.save.mockResolvedValue(undefined);

      const result = await service.importCollection('user-1');

      // Both writes go through the single transaction callback.
      expect(mockOwnershipRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(mockTransactionManager.save).toHaveBeenCalledWith(GameOwnership, [
        expect.objectContaining({ userId: 'user-1', gameId: 2 }),
      ]);
      expect(mockTransactionManager.delete).toHaveBeenCalledWith(GameOwnership, {
        id: In([10]),
      });
      expect(result).toEqual(expect.objectContaining({ added: 1, removed: 1, total: 1 }));
    });

    it('should report a valid empty sync for a collection with zero owned games', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({
        id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date(),
      });
      mockBggService.getCollection.mockResolvedValue([]);
      mockGamesService.findOrFetchMany.mockResolvedValue([]);
      mockOwnershipRepo.findBy.mockResolvedValue([makeOwnership({ id: 10, gameId: 1 })]);

      const result = await service.importCollection('user-1');

      expect(mockTransactionManager.delete).toHaveBeenCalledWith(GameOwnership, {
        id: In([10]),
      });
      expect(result).toEqual(expect.objectContaining({ added: 0, removed: 1, total: 0 }));
    });

    it('removes a BGG wishlist game that is no longer returned by BGG', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({ userId: 'user-1', bggUsername: 'aldie' });
      mockBggService.getCollection.mockResolvedValue([]);
      mockBggService.getWishlist.mockResolvedValue([]);
      mockGamesService.findOrFetchMany.mockResolvedValue([]);
      mockOwnershipRepo.findBy.mockResolvedValue([]);
      mockWishlistRepo.findBy.mockResolvedValue([{ id: 9, userId: 'user-1', gameId: 2, source: 'bgg', wishlistPriority: 3 }]);

      const result = await service.importCollection('user-1');

      expect(mockTransactionManager.delete).toHaveBeenCalledWith(GameWishlist, { id: In([9]) });
      expect(result.wishlist).toEqual({ added: 0, removed: 1, total: 0 });
    });

    it('should refuse to sync at all when BGG omitted games from the hydration batch', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({
        id: 1, userId: 'user-1', bggUsername: 'aldie', linkedAt: new Date(), createdAt: new Date(),
      });
      // BGG says the user owns two games...
      mockBggService.getCollection.mockResolvedValue([
        { bggId: 174430, name: 'Gloomhaven' },
        { bggId: 13, name: 'Catan' },
      ]);
      // ...but the `thing` batch only came back with one of them. Treating
      // the missing one as unowned would delete an ownership row for a game
      // the user demonstrably still owns.
      mockGamesService.findOrFetchMany.mockResolvedValue([makeGame({ id: 1, bggId: 174430 })]);
      mockOwnershipRepo.findBy.mockResolvedValue([
        makeOwnership({ id: 10, gameId: 1 }),
        makeOwnership({ id: 11, gameId: 2 }),
      ]);

      await expect(service.importCollection('user-1')).rejects.toThrow(HttpException);

      // Nothing written — not even the add half, and no transaction opened.
      expect(mockOwnershipRepo.manager.transaction).not.toHaveBeenCalled();
      expect(mockTransactionManager.save).not.toHaveBeenCalled();
      expect(mockTransactionManager.delete).not.toHaveBeenCalled();
      expect(mockOwnershipRepo.save).not.toHaveBeenCalled();
      expect(mockOwnershipRepo.delete).not.toHaveBeenCalled();
    });

    it('should import only the BGG rating into a BGG-sourced review', async () => {
      mockAccountsRepo.findOneBy.mockResolvedValue({ userId: 'user-1', bggUsername: 'aldie' });
      mockBggService.getCollection.mockResolvedValue([{
        bggId: 174430,
        name: 'Gloomhaven',
        userRating: 8.5,
        comment: 'Excellent campaign.',
      }]);
      mockGamesService.findOrFetchMany.mockResolvedValue([makeGame()]);
      mockOwnershipRepo.findBy.mockResolvedValue([]);
      mockReviewsRepo.create.mockImplementation((data) => data);
      mockReviewsRepo.save.mockImplementation((data) => Promise.resolve(data));

      await service.importCollection('user-1');

      expect(mockReviewsRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        gameId: 1,
        rating: 8.5,
        body: null,
        source: 'bgg',
      }));
    });

    it('updates the BGG rating without overwriting app review fields', async () => {
      const existingReview = {
        id: 7, userId: 'user-1', gameId: 1, rating: 7, body: 'Edited in the app.',
        complexityScore: 4, depthScore: 5, source: 'bgg',
      };
      mockAccountsRepo.findOneBy.mockResolvedValue({ userId: 'user-1', bggUsername: 'aldie' });
      mockBggService.getCollection.mockResolvedValue([{
        bggId: 174430, name: 'Gloomhaven', userRating: 9, comment: 'BGG comment should be ignored.',
      }]);
      mockGamesService.findOrFetchMany.mockResolvedValue([makeGame()]);
      mockOwnershipRepo.findBy.mockResolvedValue([makeOwnership()]);
      mockReviewsRepo.findBy.mockResolvedValue([existingReview]);
      mockReviewsRepo.create.mockImplementation((data) => data);
      mockReviewsRepo.save.mockImplementation((data) => Promise.resolve(data));

      await service.importCollection('user-1');

      expect(mockReviewsRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        id: 7,
        rating: 9,
        body: 'Edited in the app.',
        complexityScore: 4,
        depthScore: 5,
        source: 'bgg',
      }));
    });

    it('does not overwrite a manually created review with BGG data', async () => {
      const manualReview = {
        id: 8, userId: 'user-1', gameId: 1, rating: 6, body: 'Keep all of this.',
        complexityScore: 2, depthScore: 3, source: 'manual',
      };
      mockAccountsRepo.findOneBy.mockResolvedValue({ userId: 'user-1', bggUsername: 'aldie' });
      mockBggService.getCollection.mockResolvedValue([{
        bggId: 174430, name: 'Gloomhaven', userRating: 9, comment: 'Ignore this.',
      }]);
      mockGamesService.findOrFetchMany.mockResolvedValue([makeGame()]);
      mockOwnershipRepo.findBy.mockResolvedValue([makeOwnership()]);
      mockReviewsRepo.findBy.mockResolvedValue([manualReview]);

      await service.importCollection('user-1');

      expect(mockReviewsRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('upsertReview', () => {
    it('edits a BGG-sourced review while preserving its rating provenance', async () => {
      mockGamesService.findByIds.mockResolvedValue([makeGame()]);
      mockReviewsRepo.findOneBy.mockResolvedValue({ id: 5, source: 'bgg' });
      mockReviewsRepo.create.mockImplementation((data) => data);
      mockReviewsRepo.save.mockImplementation((data) => Promise.resolve(data));

      await service.upsertReview('user-1', 1, { rating: 9, body: 'App edit', complexityScore: 3 });

      expect(mockReviewsRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        id: 5, source: 'bgg', rating: 9, body: 'App edit', complexityScore: 3,
      }));
    });

    it('allows a comment without a rating', async () => {
      mockGamesService.findByIds.mockResolvedValue([makeGame()]);
      mockReviewsRepo.findOneBy.mockResolvedValue(null);
      mockReviewsRepo.create.mockImplementation((data) => data);
      mockReviewsRepo.save.mockImplementation((data) => Promise.resolve(data));

      await service.upsertReview('user-1', 1, { body: 'Worth playing again.' });

      expect(mockReviewsRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        rating: null, body: 'Worth playing again.', source: 'manual',
      }));
    });

    it('rejects an empty review', async () => {
      mockGamesService.findByIds.mockResolvedValue([makeGame()]);
      mockReviewsRepo.findOneBy.mockResolvedValue(null);

      await expect(service.upsertReview('user-1', 1, { body: '  ' })).rejects.toThrow('A review must contain');
    });
  });

  describe('saved games', () => {
    it('adds a game to Saved once', async () => {
      const game = makeGame();
      mockGamesService.findOrFetch.mockResolvedValue(game);
      mockSavedRepo.findOneBy.mockResolvedValue(null);
      mockSavedRepo.create.mockImplementation((data) => data);
      mockSavedRepo.save.mockImplementation((data) => Promise.resolve(data));

      await service.addSavedGame('user-1', game.bggId);

      expect(mockSavedRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        gameId: game.id,
        source: 'manual',
      }));
    });

    it('removes only the current user saved membership', async () => {
      await service.removeSavedGame('user-1', 7);

      expect(mockSavedRepo.delete).toHaveBeenCalledWith({ userId: 'user-1', gameId: 7 });
    });
  });

  describe('searchGames', () => {
    it('preserves search order and enriches results with cached thumbnails', async () => {
      mockBggService.searchGames.mockResolvedValue([
        { bggId: 2, name: 'Second', yearPublished: 2020 },
        { bggId: 1, name: 'First', yearPublished: 2019 },
      ]);
      mockGamesService.findCachedByBggIds.mockResolvedValue([
        makeGame({ bggId: 1, thumbnail: 'first.jpg' }),
        makeGame({ id: 2, bggId: 2, thumbnail: 'second.jpg' }),
      ]);

      await expect(service.searchGames(' game ')).resolves.toEqual([
        expect.objectContaining({ bggId: 2, thumbnail: 'second.jpg' }),
        expect.objectContaining({ bggId: 1, thumbnail: 'first.jpg' }),
      ]);
      expect(mockBggService.searchGames).toHaveBeenCalledWith('game');
      expect(mockGamesService.findCachedByBggIds).toHaveBeenCalledWith([2, 1]);
    });

    it('returns basic results when optional thumbnail hydration fails', async () => {
      mockBggService.searchGames.mockResolvedValue([
        { bggId: 2, name: 'Second', yearPublished: 2020 },
      ]);
      mockGamesService.findCachedByBggIds.mockRejectedValue(new Error('cache read failed'));

      await expect(service.searchGames('game')).resolves.toEqual([
        { bggId: 2, name: 'Second', yearPublished: 2020, thumbnail: '' },
      ]);
    });
  });

  describe('personal lists', () => {
    const list = {
      id: '98e8ec9a-42c6-4f8f-aa9a-8dd0115893f8',
      userId: 'user-1',
      name: 'Favorites',
      type: 'tier' as const,
      tiers: ['S', 'A'],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('hydrates a direct BGG search result and appends it to an owned list', async () => {
      mockListsRepo.findOneBy.mockResolvedValue(list);
      mockGamesService.findOrFetch.mockResolvedValue(makeGame());
      mockListItemsRepo.findOneBy.mockResolvedValue(null);
      mockListItemsRepo.findBy.mockResolvedValue([]);
      mockListItemsRepo.create.mockImplementation((data) => data);
      mockListItemsRepo.save.mockImplementation((data) => Promise.resolve(data));

      const result = await service.addListGame('user-1', list.id, {
        bggId: 174430,
        tier: 'S',
      });

      expect(mockGamesService.findOrFetch).toHaveBeenCalledWith(174430);
      expect(mockListItemsRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        listId: list.id,
        gameId: 1,
        tier: 'S',
        position: 0,
      }));
      expect(result).toEqual(expect.objectContaining({ id: 1, tier: 'S', position: 0 }));
    });

    it('rejects a tier that is not configured on the list', async () => {
      mockListsRepo.findOneBy.mockResolvedValue(list);

      await expect(service.addListGame('user-1', list.id, {
        bggId: 174430,
        tier: 'B',
      })).rejects.toThrow(/Invalid tier/);
      expect(mockGamesService.findOrFetch).not.toHaveBeenCalled();
    });

    it('does not expose a list belonging to another user', async () => {
      mockListsRepo.findOneBy.mockResolvedValue(null);

      await expect(service.removeList('user-1', list.id)).rejects.toThrow(/List not found/);
      expect(mockListsRepo.remove).not.toHaveBeenCalled();
    });

    it('normalizes positions when moving a game within a tier', async () => {
      mockListsRepo.findOneBy.mockResolvedValue(list);
      mockListItemsRepo.findOneBy.mockResolvedValue({ listId: list.id, gameId: 1, tier: 'S', position: 0 });
      mockListItemsRepo.findBy.mockResolvedValue([
        { listId: list.id, gameId: 1, tier: 'S', position: 0 },
        { listId: list.id, gameId: 2, tier: 'S', position: 1 },
      ]);
      mockListItemsRepo.save.mockImplementation((data) => Promise.resolve(data));
      mockGamesService.findByIds.mockResolvedValue([makeGame()]);

      await service.updateListGame('user-1', list.id, 1, { tier: 'S', position: 1 });

      expect(mockListItemsRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ gameId: 2, position: 0 }),
        expect.objectContaining({ gameId: 1, position: 1 }),
      ]);
    });
  });

  describe('removeReview', () => {
    it('removes the current user manual review', async () => {
      const review = { id: 4, userId: 'user-1', gameId: 1, source: 'manual' };
      mockReviewsRepo.findOneBy.mockResolvedValue(review);

      await service.removeReview('user-1', 1);

      expect(mockReviewsRepo.remove).toHaveBeenCalledWith(review);
    });

    it('rejects removal of a BGG review', async () => {
      mockReviewsRepo.findOneBy.mockResolvedValue({ source: 'bgg' });

      await expect(service.removeReview('user-1', 1)).rejects.toThrow(/BGG.*sync/);
      expect(mockReviewsRepo.remove).not.toHaveBeenCalled();
    });
  });
});
