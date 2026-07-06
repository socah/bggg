import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GroupsService } from './groups.service';
import { Group } from './group.entity';
import { AuditService } from '../audit/audit.service';

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

  // AuditService is a real dependency of GroupsService (2_audit_logging) —
  // without a mock provider here, the module fails to compile with an
  // "unknown dependency" error, same as the repository token would.
  const mockAuditService = {
    log: jest.fn(),
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
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
  });

  // Reset call counts and configured return values so tests don't bleed into
  // each other.
  afterEach(() => jest.clearAllMocks());

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return groups owned by the requesting user', async () => {
      const groups: Group[] = [
        { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, createdAt: new Date() },
        { id: 'group-2', name: 'Catan Night', ownerId: OWNER_ID, createdAt: new Date() },
      ];
      // Configure the mock to resolve with our fixture data for this test only.
      mockRepository.findBy.mockResolvedValue(groups);

      const result = await service.findAll(OWNER_ID);

      expect(result).toEqual(groups);
      // findAll scopes the query to the requester — verify that WHERE clause,
      // not just that some query ran.
      expect(mockRepository.findBy).toHaveBeenCalledWith({ ownerId: OWNER_ID });
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the group when it exists and the requester owns it', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);

      const result = await service.findOne('group-1', OWNER_ID);

      // Verify the service passed the right WHERE clause to the repository.
      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 'group-1' });
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

    it('should throw ForbiddenException when the requester does not own the group', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);

      await expect(service.findOne('group-1', 'someone-else')).rejects.toThrow(ForbiddenException);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should persist and return the new group, owned by the requester', async () => {
      const dto = { name: 'Go Club' };
      // create() builds an in-memory entity; save() persists it.
      // We mock both so the test doesn't need a database.
      const built: Group = { id: 'group-3', name: 'Go Club', ownerId: OWNER_ID, createdAt: new Date() };
      const saved: Group = { id: 'group-3', name: 'Go Club', ownerId: OWNER_ID, createdAt: new Date() };
      mockRepository.create.mockReturnValue(built);   // create() is sync
      mockRepository.save.mockResolvedValue(saved);   // save() is async

      const result = await service.create(dto, OWNER_ID);

      // ownerId is set from the requester, not the DTO — verify it's merged in.
      expect(mockRepository.create).toHaveBeenCalledWith({ ...dto, ownerId: OWNER_ID });
      expect(mockRepository.save).toHaveBeenCalledWith(built);
      expect(result).toEqual(saved);
      // create() writes an audit event after saving — see groups.service.ts.
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: OWNER_ID, action: 'group.created' }),
      );
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete the group when it exists and is owned by the requester', async () => {
      const group: Group = { id: 'group-1', name: 'Chess Club', ownerId: OWNER_ID, createdAt: new Date() };
      // remove() calls findOne() internally, so we mock findOneBy here too.
      mockRepository.findOneBy.mockResolvedValue(group);
      mockRepository.remove.mockResolvedValue(undefined);

      await service.remove('group-1', OWNER_ID);

      expect(mockRepository.remove).toHaveBeenCalledWith(group);
    });

    it('should throw NotFoundException when the group does not exist', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      await expect(service.remove('missing-id', OWNER_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
