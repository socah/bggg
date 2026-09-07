import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  const messageRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'message-1', createdAt: new Date(), ...value })),
    find: jest.fn(),
    findOne: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };
  const threadRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({
      id: 'thread-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...value,
    })),
    findOneBy: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const proposalRepository = {
    findBy: jest.fn(),
    findOneBy: jest.fn(),
  };
  const dismissalRepository = {
    findBy: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
    upsert: jest.fn(),
  };
  const groupsService = {
    findOne: jest.fn(),
    assertMember: jest.fn(),
    assertUsersShareGroup: jest.fn(),
  };

  let service: ChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    messageRepository.manager.transaction.mockImplementation(async (callback) => callback({
      getRepository: (entity: { name: string }) => entity.name === 'Message'
        ? messageRepository
        : threadRepository,
    }));
    service = new ChatService(
      messageRepository as never,
      threadRepository as never,
      dismissalRepository as never,
      proposalRepository as never,
      groupsService as never,
    );
  });

  it('creates one canonical direct thread ordering for two group members', async () => {
    threadRepository.findOneBy.mockResolvedValue(null);

    const thread = await service.getOrCreateDirectThread('user-z', 'user-a');

    expect(groupsService.assertUsersShareGroup).toHaveBeenCalledWith('user-z', 'user-a');
    expect(threadRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'direct',
      groupId: null,
      directUserA: 'user-a',
      directUserB: 'user-z',
    }));
    expect(thread.kind).toBe('direct');
  });

  it('creates a direct thread with the requesting user', async () => {
    threadRepository.findOneBy.mockResolvedValue(null);

    await service.getOrCreateDirectThread('user-a', 'user-a');

    expect(groupsService.assertUsersShareGroup).toHaveBeenCalledWith('user-a', 'user-a');
    expect(threadRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      directUserA: 'user-a',
      directUserB: 'user-a',
    }));
  });

  it('returns only the newest 100 messages in chronological order', async () => {
    threadRepository.findOneBy.mockResolvedValue({
      id: 'thread-1',
      groupId: null,
      kind: 'general',
    });
    messageRepository.find.mockResolvedValue([{ id: 'new' }, { id: 'old' }]);

    await expect(service.getHistory('thread-1', 'user-a')).resolves.toEqual([
      { id: 'old' },
      { id: 'new' },
    ]);
    expect(messageRepository.find).toHaveBeenCalledWith({
      where: { threadId: 'thread-1' },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  });

  it('does not expose a direct thread to another group member', async () => {
    threadRepository.findOneBy.mockResolvedValue({
      id: 'thread-1',
      groupId: 'group-1',
      kind: 'direct',
      directUserA: 'user-a',
      directUserB: 'user-b',
    });

    await expect(service.getHistory('thread-1', 'user-c'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(messageRepository.find).not.toHaveBeenCalled();
  });

  it('returns false when checking access to a missing thread', async () => {
    threadRepository.findOneBy.mockResolvedValue(null);

    await expect(service.canAccessThread('missing-thread', 'user-a')).resolves.toBe(false);
  });

  it('does not hide repository failures during an access check', async () => {
    threadRepository.findOneBy.mockRejectedValue(new Error('database unavailable'));

    await expect(service.canAccessThread('thread-1', 'user-a'))
      .rejects.toThrow('database unavailable');
  });

  it('trims and saves a message after rechecking thread access', async () => {
    const thread = {
      id: 'thread-1',
      groupId: 'group-1',
      kind: 'general',
      updatedAt: new Date(0),
    };
    threadRepository.findOneBy.mockResolvedValue(thread);

    const message = await service.saveMessage('thread-1', 'user-a', '  hello  ');

    expect(messageRepository.create).toHaveBeenCalledWith({
      threadId: 'thread-1',
      senderId: 'user-a',
      body: 'hello',
    });
    expect(threadRepository.update).toHaveBeenCalledWith('thread-1', {
      updatedAt: expect.any(Date),
    });
    expect(message.body).toBe('hello');
  });

  it('rejects a proposal thread when the proposal is not in the group', async () => {
    proposalRepository.findOneBy.mockResolvedValue(null);

    await expect(service.getOrCreateProposalThread('group-1', 'proposal-1', 'user-a'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a participant dismiss a direct chat from their own list', async () => {
    const thread = { id: 'thread-1', kind: 'direct', directUserA: 'user-a', directUserB: 'deleted-user' };
    threadRepository.findOneBy.mockResolvedValue(thread);

    await service.removeDirectThread('thread-1', 'user-a');

    expect(threadRepository.findOneBy).toHaveBeenCalledWith({ id: 'thread-1', kind: 'direct' });
    expect(dismissalRepository.upsert).toHaveBeenCalledWith(
      { threadId: 'thread-1', userId: 'user-a' },
      ['threadId', 'userId'],
    );
  });

  it('does not let a non-participant remove a direct chat', async () => {
    threadRepository.findOneBy.mockResolvedValue({
      id: 'thread-1', kind: 'direct', directUserA: 'user-a', directUserB: 'deleted-user',
    });

    await expect(service.removeDirectThread('thread-1', 'user-c')).rejects.toBeInstanceOf(ForbiddenException);
    expect(dismissalRepository.upsert).not.toHaveBeenCalled();
  });
});
