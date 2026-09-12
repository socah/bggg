import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { GroupsService } from './groups.service';
import { Group } from './group.entity';
import { GroupMember } from './group-member.entity';
import { GameOwnership } from '../collections/game-ownership.entity';
import { Game } from '../games/game.entity';
import { Review } from '../collections/review.entity';
import { AuditService } from '../audit/audit.service';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
import { CollectionsService } from '../collections/collections.service';

// A fixed owner id reused across fixtures — every Group row needs one now
// that ownership checks exist (2_owasp), and every service call needs a
// requesting user id to check against it.
const OWNER_ID = 'user-1';

describe('GroupsService', () => {
  let service: GroupsService;

  // Mock for Repository<Group>. Only the methods GroupsService actually calls
  // need to be listed — anything else would never be invoked.
  const mockRepository = {
    find: jest.fn(),
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  // Mock for Repository<GroupMember> — every access check now goes through
  // this, not Group.ownerId directly. See groups.service.ts.
  const mockMembersRepository = {
    findBy: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const mockOwnershipRepository = {
    findBy: jest.fn(),
  };

  const mockGamesRepository = {
    find: jest.fn(),
  };

  const mockReviewsRepository = {
    findBy: jest.fn(),
  };

  // AuditService is a real dependency of GroupsService (2_audit_logging) —
  // without a mock provider here, the module fails to compile with an
  // "unknown dependency" error, same as the repository token would.
  const mockAuditService = {
    log: jest.fn(),
  };

  const mockKeycloakAdmin = {
    getUser: jest.fn(),
  };

  const mockCollectionsService = {
    getAccount: jest.fn(),
    getLibrarySnapshot: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        // Provide the real GroupsService — it IS the thing under test.
        GroupsService,
        {
          // getRepositoryToken(Group) is the DI token @nestjs/typeorm registers
          // Repository<Group> under. Using a different token would leave the
          // real TypeORM repo injection unmatched and the module would fail to
          // compile with an "unknown dependency" error.
          provide: getRepositoryToken(Group),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(GroupMember),
          useValue: mockMembersRepository,
        },
        {
          provide: getRepositoryToken(GameOwnership),
          useValue: mockOwnershipRepository,
        },
        {
          provide: getRepositoryToken(Game),
          useValue: mockGamesRepository,
        },
        {
          provide: getRepositoryToken(Review),
          useValue: mockReviewsRepository,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        // Added alongside the mockAuditService provider, same reasoning.
        {
          provide: KeycloakAdminClient,
          useValue: mockKeycloakAdmin,
        },
        {
          provide: CollectionsService,
          useValue: mockCollectionsService,
        },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
    mockCollectionsService.getAccount.mockResolvedValue(null);
    mockCollectionsService.getLibrarySnapshot.mockResolvedValue({
      collection: [],
      wishlist: [],
      saved: [],
      lists: [],
      reviews: [],
    });
    mockReviewsRepository.findBy.mockResolvedValue([]);
  });

  // Reset call counts and configured return values so tests don't bleed into
  // each other.
  afterEach(() => jest.clearAllMocks());

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return groups the requesting user is a member of', async () => {
      const memberships: GroupMember[] = [
        { id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date() },
        { id: 2, userId: OWNER_ID, groupId: 'group-2', role: 'member', joinedAt: new Date() },
      ];
      const groups: Group[] = [
        { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() },
        { id: 'group-2', name: 'Catan Night', ownerId: 'someone-else', isSolo: false, createdAt: new Date() },
      ];
      mockMembersRepository.findBy.mockResolvedValue(memberships);
      mockRepository.findBy.mockResolvedValue(groups);

      const result = await service.findAll(OWNER_ID);

      // findAll now looks up membership rows first, not Group.ownerId — a
      // member who didn't create the group still needs to see it.
      expect(mockMembersRepository.findBy).toHaveBeenCalledWith({ userId: OWNER_ID });
      expect(mockRepository.findBy).toHaveBeenCalledWith({
        id: In(['group-1', 'group-2']),
      });
      expect(result).toEqual(groups);
    });

    it('should provision and return a solo group when the user has no memberships', async () => {
      mockMembersRepository.findBy.mockResolvedValue([]);
      const builtGroup: Group = {
        id: 'solo-1', name: 'Just Me', ownerId: OWNER_ID, isSolo: true, createdAt: new Date(),
      };
      const builtMembership: GroupMember = {
        id: 99, userId: OWNER_ID, groupId: 'solo-1', role: 'owner', joinedAt: new Date(),
      };
      mockRepository.create.mockReturnValue(builtGroup);
      mockRepository.save.mockResolvedValue(builtGroup);
      mockMembersRepository.create.mockReturnValue(builtMembership);
      mockMembersRepository.save.mockResolvedValue(builtMembership);

      const result = await service.findAll(OWNER_ID);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Just Me', ownerId: OWNER_ID, isSolo: true }),
      );
      expect(mockMembersRepository.save).toHaveBeenCalledWith(builtMembership);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: OWNER_ID, action: 'group.created' }),
      );
      // No second query against groups by id — the freshly-created group is
      // already the whole answer.
      expect(mockRepository.findBy).not.toHaveBeenCalled();
      expect(result).toEqual([builtGroup]);
    });

    it('should return the existing solo group if a concurrent request already created one', async () => {
      const conflictError = Object.assign(
        new Error('duplicate key value violates unique constraint'),
        { code: '23505' },
      );
      const existingGroup: Group = {
        id: 'solo-1', name: 'Just Me', ownerId: OWNER_ID, isSolo: true, createdAt: new Date(),
      };
      mockMembersRepository.findBy.mockResolvedValue([]);
      mockRepository.create.mockReturnValue({ name: 'Just Me', ownerId: OWNER_ID, isSolo: true });
      mockRepository.save.mockRejectedValue(conflictError);
      mockRepository.findOneBy.mockResolvedValue(existingGroup);

      const result = await service.findAll(OWNER_ID);

      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ ownerId: OWNER_ID, isSolo: true });
      expect(mockMembersRepository.save).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
      expect(result).toEqual([existingGroup]);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the group when it exists and the requester is a member', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      // 'member' (not 'owner') on purpose — findOne grants read access to
      // ANY role; the stricter owner/admin check only applies to update/remove.
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 1, userId: 'someone-else', groupId: 'group-1', role: 'member', joinedAt: new Date(),
      });

      const result = await service.findOne('group-1', 'someone-else');

      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 'group-1' });
      expect(mockMembersRepository.findOneBy).toHaveBeenCalledWith({
        groupId: 'group-1',
        userId: 'someone-else',
      });
      expect(result).toEqual(group);
    });

    it('should throw NotFoundException when the group does not exist', async () => {
      // null is what TypeORM returns when no row matches — this is what
      // triggers the `if (!group) throw new NotFoundException(...)` branch.
      mockRepository.findOneBy.mockResolvedValue(null);

      // .rejects.toThrow() is how you assert that an async function throws.
      // Without await, the assertion would not run before the test finishes.
      await expect(service.findOne('missing-id', OWNER_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when the requester has no membership row', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue(null);

      await expect(service.findOne('group-1', 'someone-else')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should persist the group, insert an owner membership row, and audit log', async () => {
      const dto = { name: 'Go Club' };
      // create() builds an in-memory entity; save() persists it.
      // We mock both so the test doesn't need a database.
      const built: Group = { id: 'group-3', name: 'Go Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      const saved: Group = { id: 'group-3', name: 'Go Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      const builtMembership: GroupMember = {
        id: 10, userId: OWNER_ID, groupId: 'group-3', role: 'owner', joinedAt: new Date(),
      };
      mockRepository.create.mockReturnValue(built);   // create() is sync
      mockRepository.save.mockResolvedValue(saved);   // save() is async
      mockMembersRepository.create.mockReturnValue(builtMembership);
      mockMembersRepository.save.mockResolvedValue(builtMembership);

      const result = await service.create(dto, OWNER_ID);

      // ownerId is set from the requester, not the DTO — verify it's merged in.
      expect(mockRepository.create).toHaveBeenCalledWith({ ...dto, ownerId: OWNER_ID });
      expect(mockRepository.save).toHaveBeenCalledWith(built);
      // Without this row, the creator couldn't see their own group afterwards
      // — findAll/findOne check group_members, not Group.ownerId.
      expect(mockMembersRepository.create).toHaveBeenCalledWith({
        userId: OWNER_ID,
        groupId: saved.id,
        role: 'owner',
      });
      expect(mockMembersRepository.save).toHaveBeenCalledWith(builtMembership);
      expect(result).toEqual(saved);
      // create() writes an audit event after saving — see groups.service.ts.
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: OWNER_ID, action: 'group.created' }),
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('should update the group when the requester is an owner or admin', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'admin', joinedAt: new Date(),
      });
      mockRepository.save.mockResolvedValue({ ...group, name: 'Chess Club Renamed' });

      const result = await service.update('group-1', { name: 'Chess Club Renamed' }, OWNER_ID);

      expect(result.name).toBe('Chess Club Renamed');
    });

    it('should throw ForbiddenException when the requester is only a member', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      // findOne's own membership check passes (any role can view)...
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 2, userId: 'a-member', groupId: 'group-1', role: 'member', joinedAt: new Date(),
      });

      // ...but assertCanManage's stricter check should still reject it.
      await expect(
        service.update('group-1', { name: 'New Name' }, 'a-member'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete the group when it exists and the requester is an owner or admin', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      // remove() calls findOne() internally, so we mock findOneBy here too.
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date(),
      });
      mockRepository.remove.mockResolvedValue(undefined);

      await service.remove('group-1', OWNER_ID);

      expect(mockRepository.remove).toHaveBeenCalledWith(group);
    });

    it('should throw NotFoundException when the group does not exist', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id', OWNER_ID)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when the requester is only a member', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 2, userId: 'a-member', groupId: 'group-1', role: 'member', joinedAt: new Date(),
      });

      await expect(service.remove('group-1', 'a-member')).rejects.toThrow(ForbiddenException);
      expect(mockRepository.remove).not.toHaveBeenCalled();
    });
  });

  // ── getMembers ───────────────────────────────────────────────────────────

  describe('getMembers', () => {
    it('uses the membership user id even if the identity provider returns a different id', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date(),
      });
      mockMembersRepository.findBy.mockResolvedValue([
        { id: 2, userId: 'canonical-user-id', groupId: 'group-1', role: 'member', joinedAt: new Date() },
      ]);
      mockKeycloakAdmin.getUser.mockResolvedValue({ id: 'provider-user-id', username: 'alice', displayName: 'Alice' });

      const result = await service.getMembers('group-1', OWNER_ID);

      expect(result).toEqual([
         { id: 'canonical-user-id', username: 'alice', displayName: 'Alice', role: 'member', isCurrentUser: false },
      ]);
    });

    it('should return display names AND group roles for every member, after checking access', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date(),
      });
      mockMembersRepository.findBy.mockResolvedValue([
        { id: 1, userId: 'user-a', groupId: 'group-1', role: 'owner', joinedAt: new Date() },
        { id: 2, userId: 'user-b', groupId: 'group-1', role: 'member', joinedAt: new Date() },
      ]);
      mockKeycloakAdmin.getUser
        .mockResolvedValueOnce({ id: 'user-a', username: 'alice', displayName: 'Alice' })
        .mockResolvedValueOnce({ id: 'user-b', username: 'bob', displayName: 'Bob' });

      const result = await service.getMembers('group-1', OWNER_ID);

      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 'group-1' });
      expect(result).toEqual([
         { id: 'user-a', username: 'alice', displayName: 'Alice', role: 'owner', isCurrentUser: false },
         { id: 'user-b', username: 'bob', displayName: 'Bob', role: 'member', isCurrentUser: false },
      ]);
    });

    it('marks the requesting member so clients do not need to match session identity', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' });
      mockMembersRepository.findBy.mockResolvedValue([
        { id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date() },
      ]);
      mockKeycloakAdmin.getUser.mockResolvedValue({ id: OWNER_ID, username: 'alice', displayName: 'Alice' });

      const result = await service.getMembers('group-1', OWNER_ID);

      expect(result[0]).toEqual({ id: OWNER_ID, username: 'alice', displayName: 'Alice', role: 'owner', isCurrentUser: true });
    });

    it('keeps membership and role data when an identity lookup fails', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' });
      mockMembersRepository.findBy.mockResolvedValue([
        { id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date() },
        { id: 2, userId: 'stale-user', groupId: 'group-1', role: 'member', joinedAt: new Date() },
      ]);
      mockKeycloakAdmin.getUser
        .mockResolvedValueOnce({ id: OWNER_ID, username: 'alice', displayName: 'Alice' })
        .mockRejectedValueOnce(new Error('not found'));

      await expect(service.getMembers('group-1', OWNER_ID)).resolves.toEqual([
        { id: OWNER_ID, username: 'alice', displayName: 'Alice', role: 'owner', isCurrentUser: true },
        { id: 'stale-user', username: 'unknown-member', displayName: 'Unknown member', role: 'member', isCurrentUser: false },
      ]);
    });

    it('should throw ForbiddenException when the requester is not a member', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue(null);

      await expect(service.getMembers('group-1', 'someone-else')).rejects.toThrow(ForbiddenException);
      expect(mockKeycloakAdmin.getUser).not.toHaveBeenCalled();
    });
  });

  describe('getMemberProfile', () => {
    it('returns every list after verifying both users belong to the group', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      const library = {
        collection: [{ id: 1, name: 'Owned game' }],
        wishlist: [{ id: 2, name: 'Wanted game' }],
        saved: [{ id: 3, name: 'Saved game' }],
        lists: [{ id: 'list-1', name: 'Favorites', items: [] }],
      };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy
        .mockResolvedValueOnce({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' })
        .mockResolvedValueOnce({ userId: 'user-2', groupId: 'group-1', role: 'member' });
      mockKeycloakAdmin.getUser.mockResolvedValue({ id: 'user-2', username: 'bob', displayName: 'Bob' });
      mockCollectionsService.getLibrarySnapshot.mockResolvedValue(library);

      await expect(service.getMemberProfile('group-1', 'user-2', OWNER_ID)).resolves.toEqual({
        id: 'user-2',
        username: 'bob',
        displayName: 'Bob',
        role: 'member',
        isCurrentUser: false,
        ...library,
      });
      expect(mockCollectionsService.getLibrarySnapshot).toHaveBeenCalledWith('user-2');
    });

    it('does not read lists when the target is not a member of the group', async () => {
      mockRepository.findOneBy.mockResolvedValue({ id: 'group-1' });
      mockMembersRepository.findOneBy
        .mockResolvedValueOnce({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' })
        .mockResolvedValueOnce(null);

      await expect(service.getMemberProfile('group-1', 'outsider', OWNER_ID)).rejects.toThrow(NotFoundException);
      expect(mockCollectionsService.getLibrarySnapshot).not.toHaveBeenCalled();
    });
  });

  // ── updateMemberRole ─────────────────────────────────────────────────────

  describe('updateMemberRole', () => {
    it('lets the owner change a non-owner member role', async () => {
      const target = { id: 2, userId: 'member-1', groupId: 'group-1', role: 'member', joinedAt: new Date() };
      mockMembersRepository.findOneBy
        .mockResolvedValueOnce({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' })
        .mockResolvedValueOnce(target);
      mockMembersRepository.save.mockResolvedValue({ ...target, role: 'admin' });

      const result = await service.updateMemberRole('group-1', 'member-1', 'admin', OWNER_ID);

      expect(mockMembersRepository.save).toHaveBeenCalledWith({ ...target, role: 'admin' });
      expect(result.role).toBe('admin');
    });

    it('prevents an admin from changing another admin role', async () => {
      mockMembersRepository.findOneBy
        .mockResolvedValueOnce({ userId: 'admin-1', groupId: 'group-1', role: 'admin' })
        .mockResolvedValueOnce({ userId: 'admin-2', groupId: 'group-1', role: 'admin' });

      await expect(service.updateMemberRole('group-1', 'admin-2', 'member', 'admin-1'))
        .rejects.toThrow(ForbiddenException);
      expect(mockMembersRepository.save).not.toHaveBeenCalled();
    });

    it('prevents changing the owner role', async () => {
      mockMembersRepository.findOneBy
        .mockResolvedValueOnce({ userId: 'admin-1', groupId: 'group-1', role: 'admin' })
        .mockResolvedValueOnce({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' });

      await expect(service.updateMemberRole('group-1', OWNER_ID, 'admin', 'admin-1'))
        .rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    it('lets an owner remove a non-owner member', async () => {
      const target = { id: 2, userId: 'member-1', groupId: 'group-1', role: 'member', joinedAt: new Date() };
      mockMembersRepository.findOneBy
        .mockResolvedValueOnce({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' })
        .mockResolvedValueOnce(target);

      await service.removeMember('group-1', 'member-1', OWNER_ID);

      expect(mockMembersRepository.remove).toHaveBeenCalledWith(target);
    });

    it('prevents removing the owner', async () => {
      mockMembersRepository.findOneBy
        .mockResolvedValueOnce({ userId: 'admin-1', groupId: 'group-1', role: 'admin' })
        .mockResolvedValueOnce({ userId: OWNER_ID, groupId: 'group-1', role: 'owner' });

      await expect(service.removeMember('group-1', OWNER_ID, 'admin-1'))
        .rejects.toThrow(ForbiddenException);
      expect(mockMembersRepository.remove).not.toHaveBeenCalled();
    });
  });

  // ── getLibrary ───────────────────────────────────────────────────────────

  describe('getLibrary', () => {
    const gameFixture = (id: number, name: string): Game => ({
      id, bggId: 1000 + id, name, description: '', thumbnail: `t-${id}.jpg`, image: '',
      minPlayers: 2, maxPlayers: 4, playingTime: 90, yearPublished: 2015, rating: 7.5,
      lastFetchedAt: new Date(), createdAt: new Date(),
    });

    it('returns the deduplicated union of all members owned games, sorted by name', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'member', joinedAt: new Date(),
      });
      mockMembersRepository.findBy.mockResolvedValue([
        { id: 1, userId: 'user-a', groupId: 'group-1', role: 'owner', joinedAt: new Date() },
        { id: 2, userId: 'user-b', groupId: 'group-1', role: 'member', joinedAt: new Date() },
      ]);
      // Both users own game 42 — the union must contain it ONCE.
      mockOwnershipRepository.findBy.mockResolvedValue([
        { id: 1, userId: 'user-a', gameId: 42, addedAt: new Date() },
        { id: 2, userId: 'user-a', gameId: 7, addedAt: new Date() },
        { id: 3, userId: 'user-b', gameId: 42, addedAt: new Date() },
      ]);
      mockGamesRepository.find.mockResolvedValue([gameFixture(7, 'Azul'), gameFixture(42, 'Gloomhaven')]);
      mockReviewsRepository.findBy.mockResolvedValue([
        { userId: 'user-a', gameId: 42, rating: 8, complexityScore: 4, depthScore: 5 },
        { userId: 'user-b', gameId: 42, rating: 6, complexityScore: 2, depthScore: null },
      ]);

      const result = await service.getLibrary('group-1', 'user-b');

      expect(result).toEqual([
        {
          id: 7, bggId: 1007, name: 'Azul', thumbnail: 't-7.jpg', image: '',
          minPlayers: 2, maxPlayers: 4, playingTime: 90, yearPublished: 2015, rating: 7.5,
          averageUserRating: null, averageComplexity: null, averageDepth: null,
          owners: [{ id: 'user-a', username: 'bob', displayName: 'Bob' }],
        },
        {
          id: 42, bggId: 1042, name: 'Gloomhaven', thumbnail: 't-42.jpg', image: '',
          minPlayers: 2, maxPlayers: 4, playingTime: 90, yearPublished: 2015, rating: 7.5,
          averageUserRating: 7, averageComplexity: 3, averageDepth: 5,
          owners: [
            { id: 'user-a', username: 'bob', displayName: 'Bob' },
            { id: 'user-b', username: 'bob', displayName: 'Bob' },
          ],
        },
      ]);
    });

    it('returns an empty array when no member owns anything', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, isSolo: false, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);
      // Requester membership for findOne's access check:
      mockMembersRepository.findOneBy.mockResolvedValue({
        id: 1, userId: OWNER_ID, groupId: 'group-1', role: 'owner', joinedAt: new Date(),
      });
      mockMembersRepository.findBy.mockResolvedValue([]);
      mockOwnershipRepository.findBy.mockResolvedValue([]);

      const result = await service.getLibrary('group-1', OWNER_ID);

      expect(result).toEqual([]);
      expect(mockGamesRepository.find).not.toHaveBeenCalled();
    });
  });
});
