import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GroupsService } from './groups.service';
import { Group } from './group.entity';

describe('GroupsService', () => {
  let service: GroupsService;

  // Mock for Repository<Group>. Only the methods GroupsService actually calls
  // need to be listed — anything else would never be invoked.
  const mockRepository = {
    find: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
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
      ],
    }).compile();

    service = module.get<GroupsService>(GroupsService);
  });

  // Reset call counts and configured return values so tests don't bleed into
  // each other.
  afterEach(() => jest.clearAllMocks());

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('should return an array of groups', async () => {
      const groups: Group[] = [
        { id: 1, name: 'Chess Club', createdAt: new Date() },
        { id: 2, name: 'Catan Night', createdAt: new Date() },
      ];
      // Configure the mock to resolve with our fixture data for this test only.
      mockRepository.find.mockResolvedValue(groups);

      const result = await service.findAll();

      expect(result).toEqual(groups);
      expect(mockRepository.find).toHaveBeenCalledTimes(1);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('should return the group when it exists', async () => {
      const group: Group = { id: 1, name: 'Chess Club', createdAt: new Date() };
      mockRepository.findOneBy.mockResolvedValue(group);

      const result = await service.findOne(1);

      // Verify the service passed the right WHERE clause to the repository.
      expect(mockRepository.findOneBy).toHaveBeenCalledWith({ id: 1 });
      expect(result).toEqual(group);
    });

    it('should throw NotFoundException when the group does not exist', async () => {
      // null is what TypeORM returns when no row matches — this is what
      // triggers the `if (!group) throw new NotFoundException(...)` branch.
      mockRepository.findOneBy.mockResolvedValue(null);

      // .rejects.toThrow() is how you assert that an async function throws.
      // Without await, the assertion would not run before the test finishes.
      await expect(service.findOne(99)).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should persist and return the new group', async () => {
      const dto = { name: 'Go Club' };
      // create() builds an in-memory entity; save() persists it.
      // We mock both so the test doesn't need a database.
      const built: Group = { id: 0, name: 'Go Club', createdAt: new Date() };
      const saved: Group = { id: 3, name: 'Go Club', createdAt: new Date() };
      mockRepository.create.mockReturnValue(built);   // create() is sync
      mockRepository.save.mockResolvedValue(saved);   // save() is async

      const result = await service.create(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(built);
      expect(result).toEqual(saved);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('should delete the group when it exists', async () => {
      const group: Group = { id: 1, name: 'Chess Club', createdAt: new Date() };
      // remove() calls findOne() internally, so we mock findOneBy here too.
      mockRepository.findOneBy.mockResolvedValue(group);
      mockRepository.remove.mockResolvedValue(undefined);

      await service.remove(1);

      expect(mockRepository.remove).toHaveBeenCalledWith(group);
    });

    it('should throw NotFoundException when the group does not exist', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });
  });
});
