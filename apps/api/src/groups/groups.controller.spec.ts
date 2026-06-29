import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { Group } from './group.entity';

// A minimal guard that always lets requests through. Used to replace the
// real AuthGuard so tests reach the controller without needing a valid JWT.
// Implements CanActivate so NestJS treats it as a valid guard.
const alwaysAllowGuard = { canActivate: () => true };

describe('GroupsController', () => {
  let controller: GroupsController;

  // Only the methods GroupsController actually calls on GroupsService.
  const mockGroupsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupsController],
      providers: [
        {
          provide: GroupsService,
          useValue: mockGroupsService,
        },
        {
          // APP_GUARD registers a guard globally for this test module, which
          // overrides the @UseGuards(AuthGuard) on the controller class.
          // Without this, AuthGuard runs and every test fails with 401 before
          // it ever reaches the controller method.
          provide: APP_GUARD,
          useValue: alwaysAllowGuard,
        },
      ],
    }).compile();

    controller = module.get<GroupsController>(GroupsController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return the array from the service', async () => {
      const groups: Group[] = [
        { id: 1, name: 'Chess Club', createdAt: new Date() },
      ];
      mockGroupsService.findAll.mockResolvedValue(groups);

      const result = await controller.findAll();

      expect(result).toEqual(groups);
      // Verify the controller delegates to the service — its only job.
      expect(mockGroupsService.findAll).toHaveBeenCalledTimes(1);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the group from the service', async () => {
      const group: Group = { id: 1, name: 'Chess Club', createdAt: new Date() };
      mockGroupsService.findOne.mockResolvedValue(group);

      const result = await controller.findOne(1);

      expect(mockGroupsService.findOne).toHaveBeenCalledWith(1);
      expect(result).toEqual(group);
    });

    it('should propagate NotFoundException from the service', async () => {
      // The controller has no 404 logic of its own — it just calls the service
      // and lets any exception bubble up to NestJS's exception filter.
      mockGroupsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should return the created group from the service', async () => {
      const dto = { name: 'Go Club' };
      const created: Group = { id: 3, name: 'Go Club', createdAt: new Date() };
      mockGroupsService.create.mockResolvedValue(created);

      const result = await controller.create(dto);

      expect(mockGroupsService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(created);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should call the service remove method', async () => {
      mockGroupsService.remove.mockResolvedValue(undefined);

      await controller.remove(1);

      expect(mockGroupsService.remove).toHaveBeenCalledWith(1);
    });
  });
});
