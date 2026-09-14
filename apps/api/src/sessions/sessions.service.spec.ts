import { SessionsService } from './sessions.service';
import { PlaySessionPlayer } from './play-session-player.entity';
import { PlaySession } from '../scheduling/play-session.entity';
import { PlaySessionGame } from '../scheduling/play-session-game.entity';
import { PlayResult } from './play-result.entity';
import { PlayUserNote } from './play-user-note.entity';

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
      startTime: '23:00',
      endTime: '01:00',
      players: [{ userId: 'user-1' }],
    }, 'user-1');

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      ['group-1', '2026-09-10'],
    );
    expect(sessionRepo.save).not.toHaveBeenCalled();
    expect(playRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      startedAt: new Date('2026-09-10T23:00:00.000Z'),
      endedAt: new Date('2026-09-11T01:00:00.000Z'),
      durationMinutes: 120,
    }));
    expect(result.sessionId).toBe('session-1');
  });
});

describe('SessionsService play summaries', () => {
  it('keeps play participants separate when games share a session', async () => {
    const session = { id: 'session-1', groupId: 'group-1', proposalId: null, placeId: null, playedAt: new Date('2026-09-10T00:00:00Z') };
    const plays = [
      { id: 'play-1', sessionId: session.id, gameId: 1, status: 'finished', durationMinutes: null, notes: null, loggedBy: 'user-1' },
      { id: 'play-2', sessionId: session.id, gameId: 2, status: 'finished', durationMinutes: null, notes: null, loggedBy: 'user-1' },
    ];
    const players = [
      { id: 'player-1', sessionId: session.id, userId: 'user-1', guestPlayerId: null },
      { id: 'player-2', sessionId: session.id, userId: null, guestPlayerId: 'guest-1' },
      { id: 'player-3', sessionId: session.id, userId: null, guestPlayerId: 'guest-2' },
    ];
    const repositories = new Map<unknown, { findBy: jest.Mock }>([
      [PlaySessionGame, { findBy: jest.fn().mockResolvedValue(plays) }],
      [PlaySessionPlayer, { findBy: jest.fn().mockResolvedValue(players) }],
      [PlayResult, { findBy: jest.fn().mockResolvedValue([
        { playId: 'play-1', sessionPlayerId: 'player-1', isWinner: true },
        { playId: 'play-1', sessionPlayerId: 'player-2', isWinner: false },
        { playId: 'play-2', sessionPlayerId: 'player-1', isWinner: false },
        { playId: 'play-2', sessionPlayerId: 'player-3', isWinner: true },
      ]) }],
      [PlayUserNote, { findBy: jest.fn().mockResolvedValue([]) }],
    ]);
    const service = new SessionsService(
      { findBy: jest.fn().mockResolvedValue([{ id: 1, name: 'Azul' }, { id: 2, name: 'Cascadia' }]) } as never,
      { findOneBy: jest.fn().mockResolvedValue({ role: 'member' }) } as never,
      { findBy: jest.fn().mockResolvedValue([{ id: 'guest-1', name: 'Bob' }, { id: 'guest-2', name: 'Carol' }]) } as never,
      { find: jest.fn().mockResolvedValue([session]) } as never,
      {} as never,
      {} as never,
      {} as never,
      { findBy: jest.fn() } as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'group-1', name: 'Thursday Games' }), getMembers: jest.fn().mockResolvedValue([{ id: 'user-1', username: 'alice', displayName: 'Alice' }]) } as never,
      { getRepository: jest.fn((entity) => repositories.get(entity)) } as never,
      {} as never,
    );

    const result = await service.listPlays('group-1', 'user-1');

    expect(result.every((play) => play.canEdit)).toBe(true);
    expect(result[0].sessionParticipants.map((player) => player.name)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(result[0].playParticipants.map((player) => player.name)).toEqual(['Alice', 'Bob']);
    expect(result[0].playParticipants.map((player) => player.isWinner)).toEqual([true, false]);
    expect(result[1].playParticipants.map((player) => player.name)).toEqual(['Alice', 'Carol']);
  });
});

describe('SessionsService user play notes', () => {
  it('returns every user note with its author and current-user marker', async () => {
    const play = { id: 'play-1', sessionId: 'session-1', notes: null };
    const repositories = new Map<unknown, unknown>([
      [PlaySessionGame, { findOneBy: jest.fn().mockResolvedValue(play) }],
      [PlayResult, { findBy: jest.fn().mockResolvedValue([]) }],
      [PlaySessionPlayer, { findBy: jest.fn().mockResolvedValue([]) }],
      [PlayUserNote, { findBy: jest.fn().mockResolvedValue([
        { playId: 'play-1', userId: 'user-1', notes: 'My note' },
        { playId: 'play-1', userId: 'user-2', notes: 'Their note' },
      ]) }],
    ]);
    const service = new SessionsService(
      {} as never,
      {} as never,
      {} as never,
      { findOneBy: jest.fn().mockResolvedValue({ id: 'session-1', groupId: 'group-1', playedAt: new Date('2026-09-10T00:00:00Z') }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'group-1' }), getMembers: jest.fn().mockResolvedValue([
        { id: 'user-1', username: 'alice', displayName: 'Alice' },
        { id: 'user-2', username: 'bob', displayName: 'Bob' },
      ]) } as never,
      { getRepository: jest.fn((entity) => repositories.get(entity)) } as never,
      {} as never,
    );

    const result = await service.getPlay('group-1', 'play-1', 'user-1');

    expect(result.notes).toEqual([
      expect.objectContaining({ userId: 'user-1', notes: 'My note', displayName: 'Alice', isCurrentUser: true }),
      expect.objectContaining({ userId: 'user-2', notes: 'Their note', displayName: 'Bob', isCurrentUser: false }),
    ]);
  });

  it('upserts and removes only the authenticated user note', async () => {
    const play = { id: 'play-1', sessionId: 'session-1' };
    const playRepo = { findOneBy: jest.fn().mockResolvedValue(play) };
    const noteRepo = {
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new SessionsService(
      {} as never,
      {} as never,
      {} as never,
      { findOneBy: jest.fn().mockResolvedValue({ id: 'session-1', groupId: 'group-1' }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'group-1' }) } as never,
      { getRepository: jest.fn((entity) => entity === PlaySessionGame ? playRepo : noteRepo) } as never,
      {} as never,
    );

    await service.updatePlayNote('group-1', 'play-1', { notes: ' Alice note ' }, 'user-1');
    await service.updatePlayNote('group-1', 'play-1', { notes: null }, 'user-1');

    expect(noteRepo.upsert).toHaveBeenCalledWith(
      { playId: 'play-1', userId: 'user-1', notes: 'Alice note' },
      ['playId', 'userId'],
    );
    expect(noteRepo.delete).toHaveBeenCalledWith({ playId: 'play-1', userId: 'user-1' });
  });
});

describe('SessionsService play participant cleanup', () => {
  it('removes only players no longer referenced by any play in the session', async () => {
    const session = { id: 'session-1', groupId: 'group-1', playedAt: new Date('2026-09-10T00:00:00Z') };
    const play = { id: 'play-1', sessionId: session.id, loggedBy: 'user-1', status: 'finished', durationMinutes: null, notes: null };
    const alice = { id: 'player-1', sessionId: session.id, userId: 'user-1', guestPlayerId: null };
    const bob = { id: 'player-2', sessionId: session.id, userId: null, guestPlayerId: 'guest-1' };
    const carol = { id: 'player-3', sessionId: session.id, userId: null, guestPlayerId: 'guest-2' };
    const participantRepo = {
      findOneBy: jest.fn().mockResolvedValue(alice),
      findBy: jest.fn().mockResolvedValue([alice, bob, carol]),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      remove: jest.fn(async (value) => value),
    };
    const resultRepo = {
      create: jest.fn((value) => value),
      delete: jest.fn().mockResolvedValue({ affected: 2 }),
      save: jest.fn(async (value) => value),
      findBy: jest.fn().mockResolvedValue([
        { playId: 'play-1', sessionPlayerId: alice.id },
        { playId: 'play-2', sessionPlayerId: carol.id },
      ]),
    };
    const playRepo = {
      findOneBy: jest.fn().mockResolvedValue(play),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === PlaySessionPlayer) return participantRepo;
        if (entity === PlayResult) return resultRepo;
        if (entity === PlaySessionGame) return playRepo;
        throw new Error('Unexpected repository');
      }),
    };
    const dataSource = {
      getRepository: jest.fn((entity) => entity === PlaySessionGame ? playRepo : null),
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const service = new SessionsService(
      {} as never,
      { findOneBy: jest.fn().mockResolvedValue({ role: 'member' }), findBy: jest.fn().mockResolvedValue([{ groupId: 'group-1', userId: 'user-1' }]) } as never,
      { findBy: jest.fn().mockResolvedValue([]) } as never,
      { findOneBy: jest.fn().mockResolvedValue(session) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'group-1' }) } as never,
      dataSource as never,
      {} as never,
    );

    await service.updatePlay('group-1', play.id, {
      status: 'finished',
      startTime: '18:30',
      endTime: '20:00',
      players: [{ userId: 'user-1' }],
    }, 'user-1');

    expect(participantRepo.remove).toHaveBeenCalledWith([bob]);
    expect(playRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      startedAt: new Date('2026-09-10T18:30:00.000Z'),
      endedAt: new Date('2026-09-10T20:00:00.000Z'),
      durationMinutes: 90,
    }));
  });
});
