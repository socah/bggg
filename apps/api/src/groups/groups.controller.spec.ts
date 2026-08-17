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

// Since alwaysAllowGuard never runs the real AuthGuard, req.user is never
// populated by anything — the controller methods read req.user.sub directly,
// so tests have to fake that shape themselves.
const fakeRequest = { user: { sub: 'user-1' } };

describe('GroupsController', () => {
  let controller: GroupsController;

  // Only the methods GroupsController actually calls on GroupsService.
  const mockGroupsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getMembers: jest.fn(),
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
        { id: 'group-1', name: 'Chess Club', ownerId: 'user-1', isSolo: false, createdAt: new Date() },
      ];
      mockGroupsService.findAll.mockResolvedValue(groups);

      const result = await controller.findAll(fakeRequest);

      expect(result).toEqual(groups);
      // Verify the controller delegates to the service with the requester's
      // id extracted from the token — its only job.
      expect(mockGroupsService.findAll).toHaveBeenCalledWith('user-1');
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the group from the service', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: 'user-1', isSolo: false, createdAt: new Date() };
      mockGroupsService.findOne.mockResolvedValue(group);

      const result = await controller.findOne('group-1', fakeRequest);

      expect(mockGroupsService.findOne).toHaveBeenCalledWith('group-1', 'user-1');
      expect(result).toEqual(group);
    });

    it('should propagate NotFoundException from the service', async () => {
      // The controller has no 404 logic of its own — it just calls the service
      // and lets any exception bubble up to NestJS's exception filter.
      mockGroupsService.findOne.mockRejectedValue(new NotFoundException());

      await expect(controller.findOne('missing-id', fakeRequest)).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should return the created group from the service', async () => {
      const dto = { name: 'Go Club' };
      const created: Group = { id: 'group-3', name: 'Go Club', ownerId: 'user-1', isSolo: false, createdAt: new Date() };
      mockGroupsService.create.mockResolvedValue(created);

      const result = await controller.create(dto, fakeRequest);

      expect(mockGroupsService.create).toHaveBeenCalledWith(dto, 'user-1');
      expect(result).toEqual(created);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should call the service remove method', async () => {
      mockGroupsService.remove.mockResolvedValue(undefined);

      await controller.remove('group-1', fakeRequest);

      expect(mockGroupsService.remove).toHaveBeenCalledWith('group-1', 'user-1');
    });
  });

  // ── getMembers ───────────────────────────────────────────────────────────

  describe('getMembers', () => {
    it('should call groupsService.getMembers with the group id and requesting user', async () => {
      const members = [{ id: 'user-a', displayName: 'Alice' }];
      mockGroupsService.getMembers.mockResolvedValue(members);

      const result = await controller.getMembers('group-1', fakeRequest);

      expect(mockGroupsService.getMembers).toHaveBeenCalledWith('group-1', 'user-1');
      expect(result).toEqual(members);
    });
  });
});
