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
