import { Test, TestingModule } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { LinkBggAccountDto } from './dto/link-bgg-account.dto';

const alwaysAllowGuard = { canActivate: () => true };
type AuthenticatedRequest = { user: { sub: string } };
const fakeRequest: AuthenticatedRequest = { user: { sub: 'user-1' } };

describe('CollectionsController', () => {
  let controller: CollectionsController;

  const mockCollectionsService = {
    getAccount: jest.fn(),
    linkAccount: jest.fn(),
    unlinkAccount: jest.fn(),
    importCollection: jest.fn(),
    getOwnedGames: jest.fn(),
    getSavedGames: jest.fn(),
    getReviews: jest.fn(),
    addSavedGame: jest.fn(),
    removeSavedGame: jest.fn(),
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

      await controller.getAccount(fakeRequest);

      expect(mockCollectionsService.getAccount).toHaveBeenCalledWith('user-1');
    });
  });

  describe('linkAccount', () => {
    it('should call the service with the user id and the dto username', async () => {
      const dto: LinkBggAccountDto = { bggUsername: 'aldie' };
      mockCollectionsService.linkAccount.mockResolvedValue({ id: 1 });

      await controller.linkAccount(dto, fakeRequest);

      expect(mockCollectionsService.linkAccount).toHaveBeenCalledWith('user-1', 'aldie');
    });
  });

  describe('unlinkAccount', () => {
    it('should call the service with the requesting user id', async () => {
      await controller.unlinkAccount(fakeRequest);

      expect(mockCollectionsService.unlinkAccount).toHaveBeenCalledWith('user-1');
    });
  });

  describe('importCollection', () => {
    it('should call the service with the requesting user id', async () => {
      mockCollectionsService.importCollection.mockResolvedValue({ added: 0, removed: 0, total: 0 });

      await controller.importCollection(fakeRequest);

      expect(mockCollectionsService.importCollection).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getOwnedGames', () => {
    it('should call the service with the requesting user id', async () => {
      mockCollectionsService.getOwnedGames.mockResolvedValue([]);

      await controller.getOwnedGames(fakeRequest);

      expect(mockCollectionsService.getOwnedGames).toHaveBeenCalledWith('user-1');
    });
  });

  describe('saved games', () => {
    it('gets, adds, and removes Saved games for the requesting user', async () => {
      mockCollectionsService.getSavedGames.mockResolvedValue([]);
      mockCollectionsService.addSavedGame.mockResolvedValue({ id: 7 });

      await controller.getSavedGames(fakeRequest);
      await controller.addSavedGame({ bggId: 42 }, fakeRequest);
      await controller.removeSavedGame(7, fakeRequest);

      expect(mockCollectionsService.getSavedGames).toHaveBeenCalledWith('user-1');
      expect(mockCollectionsService.addSavedGame).toHaveBeenCalledWith('user-1', 42);
      expect(mockCollectionsService.removeSavedGame).toHaveBeenCalledWith('user-1', 7);
    });
  });

  describe('getReviews', () => {
    it('returns reviews for the requesting user', async () => {
      mockCollectionsService.getReviews.mockResolvedValue([]);

      await controller.getReviews(fakeRequest);

      expect(mockCollectionsService.getReviews).toHaveBeenCalledWith('user-1');
    });
  });
});
