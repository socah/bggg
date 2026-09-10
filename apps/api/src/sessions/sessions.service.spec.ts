import { SessionsService } from './sessions.service';
import { PlaySessionPlayer } from './play-session-player.entity';
import { PlaySession } from '../scheduling/play-session.entity';
import { PlaySessionGame } from '../scheduling/play-session-game.entity';
import { PlayResult } from './play-result.entity';

describe('SessionsService play roster context', () => {
  const members = { findOneBy: jest.fn() };
  const guests = { find: jest.fn() };
  const sessions = { find: jest.fn() };
  const groupsService = { findOne: jest.fn(), getMembers: jest.fn() };
  const sessionPlayers = { findBy: jest.fn() };
  const dataSource = { getRepository: jest.fn() };

  const service = new SessionsService(
    {} as never,
    members as never,
    guests as never,
    sessions as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    groupsService as never,
    dataSource as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    groupsService.findOne.mockResolvedValue({ id: 'group-1' });
    groupsService.getMembers.mockResolvedValue([{ id: 'user-1', username: 'alice' }]);
    guests.find.mockResolvedValue([{ id: 'guest-1', name: 'Bob' }]);
    members.findOneBy.mockResolvedValue({ role: 'owner' });
    dataSource.getRepository.mockImplementation((entity) => entity === PlaySessionPlayer ? sessionPlayers : null);
  });

  it('returns member and guest participants from the existing session on that date', async () => {
    sessions.find.mockResolvedValue([{
      id: 'session-1', groupId: 'group-1', proposalId: null, playedAt: new Date('2026-09-10T00:00:00Z'),
    }]);
    sessionPlayers.findBy.mockResolvedValue([
      { sessionId: 'session-1', userId: 'user-1', guestPlayerId: null },
      { sessionId: 'session-1', userId: null, guestPlayerId: 'guest-1' },
    ]);

    const result = await service.listPlayers('group-1', 'user-1', { playedDate: '2026-09-10' });

    expect(result.sessionId).toBe('session-1');
    expect(result.sessionPlayerIds).toEqual(['user:user-1', 'guest:guest-1']);
    expect(sessions.find).toHaveBeenCalledWith(expect.objectContaining({
      order: { playedAt: 'ASC', id: 'ASC' },
    }));
  });

  it('returns no session defaults when the date has no session', async () => {
    sessions.find.mockResolvedValue([]);

    const result = await service.listPlayers('group-1', 'user-1', { playedDate: '2026-09-11' });

    expect(result.sessionId).toBeNull();
    expect(result.sessionPlayerIds).toEqual([]);
    expect(sessionPlayers.findBy).not.toHaveBeenCalled();
  });
});

describe('SessionsService play creation', () => {
  it('locks and reuses an existing session instead of creating another one', async () => {
    const existingSession = {
      id: 'session-1', groupId: 'group-1', proposalId: null, playedAt: new Date('2026-09-10T00:00:00Z'),
    };
    const sessionRepo = {
      find: jest.fn().mockResolvedValue([existingSession]),
      create: jest.fn(),
      save: jest.fn(),
    };
    const participant = { id: 'participant-1', sessionId: 'session-1', userId: 'user-1', guestPlayerId: null };
    const participantRepo = { findOneBy: jest.fn().mockResolvedValue(participant), create: jest.fn(), save: jest.fn() };
    const playRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'play-2', ...value })),
    };
    const resultRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === PlaySession) return sessionRepo;
        if (entity === PlaySessionPlayer) return participantRepo;
        if (entity === PlaySessionGame) return playRepo;
        if (entity === PlayResult) return resultRepo;
        throw new Error('Unexpected repository');
      }),
    };
    const dataSource = { transaction: jest.fn(async (callback) => callback(manager)) };
    const service = new SessionsService(
      { findOneBy: jest.fn().mockResolvedValue({ id: 42, name: 'Azul' }) } as never,
      { findBy: jest.fn().mockResolvedValue([{ groupId: 'group-1', userId: 'user-1' }]) } as never,
      {} as never,
      {} as never,
      {} as never,
      { findBy: jest.fn() } as never,
      { findBy: jest.fn() } as never,
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'group-1' }) } as never,
      dataSource as never,
      {} as never,
    );

    const result = await service.createPlay('group-1', {
      gameId: 42,
      playedDate: '2026-09-10',
      status: 'finished',
      players: [{ userId: 'user-1' }],
    }, 'user-1');

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      ['group-1', '2026-09-10'],
    );
    expect(sessionRepo.save).not.toHaveBeenCalled();
    expect(playRepo.create).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }));
    expect(result.sessionId).toBe('session-1');
  });
});
