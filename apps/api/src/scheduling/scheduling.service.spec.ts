import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { PlaySessionProposal } from './play-session-proposal.entity';
import { PlaySessionRsvp } from './play-session-rsvp.entity';
import { PlaySession } from './play-session.entity';
import { PlaySessionProposalGame } from './play-session-proposal-game.entity';
import { PlaySessionProposalGameVote } from './play-session-proposal-game-vote.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Game } from '../games/game.entity';
import { GroupsService } from '../groups/groups.service';
import { Place } from './place.entity';
import { PlaceOwner } from './place-owner.entity';
import { PlaceVisibility } from './place-visibility.entity';
import { ProposalPlace } from './proposal-place.entity';
import { ProposalPlaceVote } from './proposal-place-vote.entity';
import { PlaySessionHost } from './play-session-host.entity';
import { PlaySessionGame } from './play-session-game.entity';
import { NotificationsService } from '../notifications/notifications.service';

const GROUP_ID = 'group-1';
const PROPOSAL_ID = 'proposal-1';
const USER_ID = 'user-1';

describe('SchedulingService', () => {
  let service: SchedulingService;

  const mockProposals = { find: jest.fn(), findOneBy: jest.fn(), findBy: jest.fn(), save: jest.fn(), remove: jest.fn() };
  const mockRsvps = { findBy: jest.fn() };
  const mockSessions = {
    findOneBy: jest.fn(), findBy: jest.fn(), remove: jest.fn(), create: jest.fn(), save: jest.fn(), countBy: jest.fn(),
  };
  const mockProposalGames = { findBy: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn() };
  const mockGameVotes = { findBy: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn() };
  const mockGames = { findBy: jest.fn() };
  const mockPlaces = { findOneBy: jest.fn(), findBy: jest.fn(), create: jest.fn(), save: jest.fn() };
  const mockPlaceOwners = { findBy: jest.fn(), upsert: jest.fn(), delete: jest.fn() };
  const mockPlaceVisibility = { findBy: jest.fn(), upsert: jest.fn() };
  const mockProposalPlaces = {
    findBy: jest.fn(), findOneBy: jest.fn(), countBy: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn(),
  };
  const mockPlaceVotes = {
    findBy: jest.fn(), findOneBy: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn(),
  };
  const mockSessionHosts = {
    create: jest.fn(), save: jest.fn(), countBy: jest.fn(), createQueryBuilder: jest.fn(),
  };
  const mockSessionGames = { existsBy: jest.fn().mockResolvedValue(false) };
  const mockMembers = { findOneBy: jest.fn(), findBy: jest.fn() };
  const mockGroupsService = { findOne: jest.fn(), getMembers: jest.fn() };
  const mockNotifications = { notifyProposalUpdate: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SchedulingService,
        { provide: getRepositoryToken(PlaySessionProposal), useValue: mockProposals },
        { provide: getRepositoryToken(PlaySessionRsvp), useValue: mockRsvps },
        { provide: getRepositoryToken(PlaySession), useValue: mockSessions },
        { provide: getRepositoryToken(PlaySessionProposalGame), useValue: mockProposalGames },
        { provide: getRepositoryToken(PlaySessionProposalGameVote), useValue: mockGameVotes },
        { provide: getRepositoryToken(Game), useValue: mockGames },
        { provide: getRepositoryToken(Place), useValue: mockPlaces },
        { provide: getRepositoryToken(PlaceOwner), useValue: mockPlaceOwners },
        { provide: getRepositoryToken(PlaceVisibility), useValue: mockPlaceVisibility },
        { provide: getRepositoryToken(ProposalPlace), useValue: mockProposalPlaces },
        { provide: getRepositoryToken(ProposalPlaceVote), useValue: mockPlaceVotes },
        { provide: getRepositoryToken(PlaySessionHost), useValue: mockSessionHosts },
        { provide: getRepositoryToken(PlaySessionGame), useValue: mockSessionGames },
        { provide: getRepositoryToken(GroupMember), useValue: mockMembers },
        { provide: GroupsService, useValue: mockGroupsService },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<SchedulingService>(SchedulingService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('listProposals', () => {
    it('includes only yes or confirmed participants', async () => {
      const proposal = { id: PROPOSAL_ID, groupId: GROUP_ID, proposedDate: '2026-08-20' };
      mockProposals.find.mockResolvedValue([proposal]);
      mockSessions.findBy.mockResolvedValue([]);
      mockRsvps.findBy.mockResolvedValue([
        { proposalId: PROPOSAL_ID, userId: 'user-yes', status: 'yes', confirmed: false },
        { proposalId: PROPOSAL_ID, userId: 'user-confirmed', status: 'maybe', confirmed: true },
        { proposalId: PROPOSAL_ID, userId: 'user-maybe', status: 'maybe', confirmed: false },
        { proposalId: PROPOSAL_ID, userId: 'user-no', status: 'no', confirmed: false },
      ]);
      mockGroupsService.getMembers.mockResolvedValue([
        { id: 'user-yes', displayName: 'Yes Player', username: 'yes' },
        { id: 'user-confirmed', displayName: 'Confirmed Player', username: 'confirmed' },
      ]);

      const result = await service.listProposals(GROUP_ID, USER_ID);

      expect(result[0].participants).toEqual([
        { id: 'user:user-yes', name: 'Yes Player' },
        { id: 'user:user-confirmed', name: 'Confirmed Player' },
      ]);
    });
  });

  describe('getProposal', () => {
    it('should return the proposal, its rsvps, and its proposed games with vote counts', async () => {
      const proposal: PlaySessionProposal = {
        id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-20',
        hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
      };
      const rsvps: PlaySessionRsvp[] = [
        { id: 1, proposalId: PROPOSAL_ID, userId: USER_ID, status: 'yes', availableStart: null, availableEnd: null, confirmed: false, createdAt: new Date(), updatedAt: new Date() },
      ];
      const proposalGame: PlaySessionProposalGame = {
        id: 'pg-1', proposalId: PROPOSAL_ID, gameId: 42, proposedBy: USER_ID, createdAt: new Date(),
      };
      const game: Game = {
        id: 42, bggId: 174430, name: 'Gloomhaven', description: '', thumbnail: '', image: '',
        minPlayers: 1, maxPlayers: 4, playingTime: 120, yearPublished: 2017, rating: 8.79,
        lastFetchedAt: new Date(), createdAt: new Date(),
      };
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockRsvps.findBy.mockResolvedValue(rsvps);
      mockProposalGames.findBy.mockResolvedValue([proposalGame]);
      mockGames.findBy.mockResolvedValue([game]);
      mockGameVotes.findBy.mockResolvedValue([
        { proposalGameId: 'pg-1', userId: 'user-2', value: 1 },
        { proposalGameId: 'pg-1', userId: 'user-3', value: 1 },
      ]);
      mockProposalPlaces.findBy.mockResolvedValue([]);

      const result = await service.getProposal(PROPOSAL_ID, USER_ID);

      expect(result).toEqual({
        proposal,
        rsvps,
        canManage: true,
        session: null,
        places: [],
        games: [{
          proposalGameId: 'pg-1',
          game: { id: 42, bggId: 174430, name: 'Gloomhaven', thumbnail: '', image: '', minPlayers: 1, maxPlayers: 4, playingTime: 120, yearPublished: 2017, rating: 8.79 },
          voteCount: 2,
          votedByMe: false,
          downvotedByMe: false,
          proposedByMe: true,
        }],
      });
    });

    it('marks games the requesting user has already voted for as votedByMe', async () => {
      const proposal: PlaySessionProposal = {
        id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-20',
        hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
      };
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockProposalGames.findBy.mockResolvedValue([
        { id: 'pg-1', proposalId: PROPOSAL_ID, gameId: 42, proposedBy: USER_ID, createdAt: new Date() },
      ]);
      mockGames.findBy.mockResolvedValue([
        { id: 42, bggId: 174430, name: 'Gloomhaven', description: '', thumbnail: '', image: '',
          minPlayers: 1, maxPlayers: 4, playingTime: 120, yearPublished: 2017, rating: 8.79,
          lastFetchedAt: new Date(), createdAt: new Date() },
      ]);
      mockGameVotes.findBy.mockResolvedValue([
        { proposalGameId: 'pg-1', userId: USER_ID, value: 1 },
        { proposalGameId: 'pg-1', userId: 'user-2', value: 1 },
        { proposalGameId: 'pg-1', userId: 'user-3', value: 1 },
      ]);

      const result = await service.listProposalGames(PROPOSAL_ID, USER_ID);

      expect(result).toEqual([{
        proposalGameId: 'pg-1',
        game: { id: 42, bggId: 174430, name: 'Gloomhaven', thumbnail: '', image: '', minPlayers: 1, maxPlayers: 4, playingTime: 120, yearPublished: 2017, rating: 8.79 },
        voteCount: 3,
        votedByMe: true,
        downvotedByMe: false,
        proposedByMe: true,
      }]);
      expect(mockGameVotes.findBy).toHaveBeenCalledWith({ proposalGameId: 'pg-1' });
    });

    it('orders proposed games by vote count, then by name', async () => {
      const proposal = baseProposal();
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockProposalGames.findBy.mockResolvedValue([
        { id: 'pg-1', proposalId: PROPOSAL_ID, gameId: 1, proposedBy: USER_ID, createdAt: new Date() },
        { id: 'pg-2', proposalId: PROPOSAL_ID, gameId: 2, proposedBy: USER_ID, createdAt: new Date() },
        { id: 'pg-3', proposalId: PROPOSAL_ID, gameId: 3, proposedBy: USER_ID, createdAt: new Date() },
      ]);
      mockGames.findBy.mockResolvedValue([
        { id: 1, name: 'Catan' },
        { id: 2, name: 'Azul' },
        { id: 3, name: 'Brass' },
      ]);
      mockGameVotes.findBy
        .mockResolvedValueOnce([{ userId: 'user-2', value: 1 }])
        .mockResolvedValueOnce([{ userId: 'user-2', value: 1 }, { userId: 'user-3', value: 1 }, { userId: 'user-4', value: 1 }])
        .mockResolvedValueOnce([{ userId: 'user-2', value: 1 }, { userId: 'user-3', value: 1 }, { userId: 'user-4', value: 1 }]);

      const result = await service.listProposalGames(PROPOSAL_ID, USER_ID);

      expect(result.map((row) => row.game.name)).toEqual(['Azul', 'Brass', 'Catan']);
    });
  });

  const baseProposal = (): PlaySessionProposal => ({
    id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-30',
    hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
  });

  describe('proposal game voting and removal', () => {
    const proposalGame = {
      id: 'pg-1', proposalId: PROPOSAL_ID, gameId: 42, proposedBy: USER_ID, createdAt: new Date(),
    };

    it('stores a downvote and can replace an existing upvote', async () => {
      mockProposalGames.findOneBy.mockResolvedValue(proposalGame);
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockGameVotes.findOneBy.mockResolvedValue({ proposalGameId: 'pg-1', userId: USER_ID, value: 1 });

      await service.voteForGame(PROPOSAL_ID, 'pg-1', USER_ID, -1);

      expect(mockGameVotes.save).toHaveBeenCalledWith(expect.objectContaining({ value: -1 }));
    });

    it('lets only the suggester remove a proposed game', async () => {
      mockProposalGames.findOneBy.mockResolvedValue(proposalGame);
      mockProposals.findOneBy.mockResolvedValue(baseProposal());

      await service.removeProposalGame(PROPOSAL_ID, 'pg-1', USER_ID);
      expect(mockProposalGames.remove).toHaveBeenCalledWith(proposalGame);

      await expect(service.removeProposalGame(PROPOSAL_ID, 'pg-1', 'user-2'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects voting after collection closes', async () => {
      mockProposalGames.findOneBy.mockResolvedValue(proposalGame);
      mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), status: 'confirming' });

      await expect(service.voteForGame(PROPOSAL_ID, 'pg-1', USER_ID, 1))
        .rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('places', () => {
    it('synchronizes newly accessible places and sorts owned places before global frequency', async () => {
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockPlaceOwners.findBy.mockResolvedValue([{ placeId: 'owned', userId: USER_ID }]);
      mockPlaceVisibility.findBy.mockResolvedValue([{ placeId: 'seen', userId: USER_ID, hidden: false }]);
      mockMembers.findBy.mockResolvedValue([{ groupId: GROUP_ID, userId: USER_ID }]);
      mockProposals.findBy.mockResolvedValue([{ id: 'accessible-proposal' }]);
      mockProposalPlaces.findBy.mockResolvedValue([{ placeId: 'discovered' }]);
      mockPlaces.findBy.mockResolvedValue([
        { id: 'seen', name: 'Alpha' },
        { id: 'discovered', name: 'Beta' },
        { id: 'owned', name: 'Zulu' },
      ]);
      mockProposalPlaces.countBy
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(1);

      const result = await service.listAvailablePlaces(USER_ID);

      expect(result.map((row) => row.place.id)).toEqual(['owned', 'discovered', 'seen']);
      expect(mockPlaceVisibility.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          { placeId: 'owned', userId: USER_ID, hidden: false },
          { placeId: 'discovered', userId: USER_ID, hidden: false },
        ]),
        ['placeId', 'userId'],
      );
    });

    it('rejects a nested place action when the join row belongs to another proposal', async () => {
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockProposalPlaces.findOneBy.mockResolvedValue(null);

      await expect(service.voteForPlace(PROPOSAL_ID, 'other-row', USER_ID, 1))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockProposalPlaces.findOneBy).toHaveBeenCalledWith({
        id: 'other-row',
        proposalId: PROPOSAL_ID,
      });
      expect(mockPlaceVotes.save).not.toHaveBeenCalled();
    });

    it('sums signed votes and reports the caller voting and suggestion state', async () => {
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockProposalPlaces.findBy.mockResolvedValue([
        { id: 'pp-1', proposalId: PROPOSAL_ID, placeId: 'place-1', proposedBy: USER_ID },
      ]);
      mockPlaces.findBy.mockResolvedValue([{ id: 'place-1', name: 'Cafe' }]);
      mockPlaceOwners.findBy.mockResolvedValue([]);
      mockPlaceVotes.findBy.mockResolvedValue([
        { proposalPlaceId: 'pp-1', userId: USER_ID, value: -1 },
        { proposalPlaceId: 'pp-1', userId: 'user-2', value: 1 },
      ]);

      await expect(service.listProposalPlaces(PROPOSAL_ID, USER_ID)).resolves.toEqual([{
        proposalPlaceId: 'pp-1',
        place: { id: 'place-1', name: 'Cafe' },
        voteCount: 0,
        votedByMe: false,
        downvotedByMe: true,
        proposedByMe: true,
        ownedByMe: false,
        ownerIds: [],
      }]);
    });

    it('lets only the suggester remove a suggested place', async () => {
      const proposalPlace = { id: 'pp-1', proposalId: PROPOSAL_ID, placeId: 'place-1', proposedBy: USER_ID };
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockProposalPlaces.findOneBy.mockResolvedValue(proposalPlace);

      await service.removeProposalPlace(PROPOSAL_ID, 'pp-1', USER_ID);
      expect(mockProposalPlaces.remove).toHaveBeenCalledWith(proposalPlace);

      await expect(service.removeProposalPlace(PROPOSAL_ID, 'pp-1', 'user-2'))
        .rejects.toBeInstanceOf(ForbiddenException);
    });

    it('hides a saved place without deleting the shared place', async () => {
      mockPlaces.findOneBy.mockResolvedValue({ id: 'place-1', name: 'Cafe' });

      await service.removeSavedPlace('place-1', USER_ID);

      expect(mockPlaceVisibility.upsert).toHaveBeenCalledWith(
        { placeId: 'place-1', userId: USER_ID, hidden: true },
        ['placeId', 'userId'],
      );
    });

    it('keeps a hidden place out of the saved list even when it is rediscovered', async () => {
      mockPlaceOwners.findBy.mockResolvedValue([]);
      mockPlaceVisibility.findBy.mockResolvedValue([{
        placeId: 'place-1', userId: USER_ID, hidden: true,
      }]);
      mockMembers.findBy.mockResolvedValue([{ groupId: GROUP_ID, userId: USER_ID }]);
      mockProposals.findBy.mockResolvedValue([{ id: PROPOSAL_ID }]);
      mockProposalPlaces.findBy.mockResolvedValue([{ placeId: 'place-1' }]);

      await expect(service.listAvailablePlaces(USER_ID)).resolves.toEqual([]);
      expect(mockPlaceVisibility.upsert).not.toHaveBeenCalled();
    });

    it('replaces an existing place upvote with a downvote', async () => {
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockProposalPlaces.findOneBy.mockResolvedValue({
        id: 'pp-1', proposalId: PROPOSAL_ID, placeId: 'place-1', proposedBy: USER_ID,
      });
      mockPlaceVotes.findOneBy.mockResolvedValue({
        proposalPlaceId: 'pp-1', userId: USER_ID, value: 1,
      });

      await service.voteForPlace(PROPOSAL_ID, 'pp-1', USER_ID, -1);

      expect(mockPlaceVotes.save).toHaveBeenCalledWith(expect.objectContaining({ value: -1 }));
    });
  });

  describe('requestConfirmation', () => {
    it('derives all hosts from owners of places suggested on the proposal', async () => {
      const proposal = baseProposal();
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockProposals.save.mockImplementation(async (value: PlaySessionProposal) => value);
      mockRsvps.findBy.mockResolvedValue([
        { userId: 'host-1', status: 'yes', availableStart: new Date('2026-08-30T10:00:00Z'), availableEnd: new Date('2026-08-30T12:00:00Z') },
        { userId: 'guest', status: 'yes', availableStart: new Date('2026-08-30T11:00:00Z'), availableEnd: new Date('2026-08-30T13:00:00Z') },
      ]);
      mockProposalPlaces.findBy.mockResolvedValue([{ placeId: 'place-1' }]);
      mockPlaceOwners.findBy.mockResolvedValue([{ placeId: 'place-1', userId: 'host-1' }]);

      const result = await service.requestConfirmation(PROPOSAL_ID, USER_ID);

      expect(result.status).toBe('confirming');
      expect(result.confirmedStart).toEqual(new Date('2026-08-30T11:00:00Z'));
      expect(result.confirmedEnd).toEqual(new Date('2026-08-30T12:00:00Z'));
    });

    it('directly confirms and creates a session for the sole attendee', async () => {
      const proposal = baseProposal();
      const session = { id: 'session-1', groupId: GROUP_ID, proposalId: PROPOSAL_ID };
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockProposals.save.mockImplementation(async (value: PlaySessionProposal) => value);
      mockRsvps.findBy.mockResolvedValue([{
        userId: USER_ID,
        status: 'yes',
        availableStart: new Date('2026-08-30T10:00:00Z'),
        availableEnd: new Date('2026-08-30T12:00:00Z'),
      }]);
      mockProposalPlaces.findBy.mockResolvedValue([]);
      mockSessions.create.mockReturnValue(session);
      mockSessions.save.mockResolvedValue(session);

      const result = await service.requestConfirmation(PROPOSAL_ID, USER_ID);

      expect(result.status).toBe('confirmed');
      expect(mockSessions.save).toHaveBeenCalledWith(session);
    });
  });

  describe('finalize', () => {
    it('snapshots all distinct current owners of suggested places', async () => {
      const proposal = {
        ...baseProposal(),
        status: 'confirming' as const,
        confirmedStart: new Date('2026-08-30T11:00:00Z'),
      };
      const session = { id: 'session-1', groupId: GROUP_ID, proposalId: PROPOSAL_ID };
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockProposals.save.mockImplementation(async (value: PlaySessionProposal) => value);
      mockSessions.create.mockReturnValue(session);
      mockSessions.save.mockResolvedValue(session);
      mockProposalPlaces.findBy.mockResolvedValue([{ placeId: 'place-1' }, { placeId: 'place-2' }]);
      mockPlaceOwners.findBy.mockResolvedValue([
        { placeId: 'place-1', userId: 'host-1' },
        { placeId: 'place-2', userId: 'host-1' },
        { placeId: 'place-2', userId: 'host-2' },
      ]);
      mockSessionHosts.create.mockImplementation((value) => value);

      await service.finalize(PROPOSAL_ID, USER_ID);

      expect(mockSessionHosts.save).toHaveBeenCalledWith([
        { sessionId: 'session-1', userId: 'host-1' },
        { sessionId: 'session-1', userId: 'host-2' },
      ]);
    });
  });

  describe('hosting stats', () => {
    it('counts the authenticated user from host snapshots', async () => {
      mockSessionHosts.countBy.mockResolvedValue(3);

      await expect(service.getMyHostingStats(USER_ID)).resolves.toEqual({ hostedSessionCount: 3 });
      expect(mockSessionHosts.countBy).toHaveBeenCalledWith({ userId: USER_ID });
    });

    it('checks membership and returns group totals with sorted host snapshot counts', async () => {
      const queryBuilder = {
        innerJoin: jest.fn(), select: jest.fn(), addSelect: jest.fn(), where: jest.fn(),
        groupBy: jest.fn(), orderBy: jest.fn(), addOrderBy: jest.fn(), getRawMany: jest.fn(),
      };
      for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'groupBy', 'orderBy', 'addOrderBy'] as const) {
        queryBuilder[method].mockReturnValue(queryBuilder);
      }
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockSessions.countBy.mockResolvedValue(5);
      queryBuilder.getRawMany.mockResolvedValue([
        { userId: 'host-b', hostedSessionCount: '3' },
        { userId: 'host-a', hostedSessionCount: '2' },
      ]);
      mockSessionHosts.createQueryBuilder.mockReturnValue(queryBuilder);

      await expect(service.getGroupHostingStats(GROUP_ID, USER_ID)).resolves.toEqual({
        totalSessionCount: 5,
        hosts: [
          { userId: 'host-b', hostedSessionCount: 3 },
          { userId: 'host-a', hostedSessionCount: 2 },
        ],
      });
      expect(mockGroupsService.findOne).toHaveBeenCalledWith(GROUP_ID, USER_ID);
      expect(mockSessions.countBy).toHaveBeenCalledWith({ groupId: GROUP_ID });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('COUNT(*)', 'DESC');
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('host.user_id', 'ASC');
    });

    it('does not query group stats when the membership check fails', async () => {
      mockGroupsService.findOne.mockRejectedValue(new ForbiddenException());

      await expect(service.getGroupHostingStats(GROUP_ID, USER_ID))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockSessions.countBy).not.toHaveBeenCalled();
      expect(mockSessionHosts.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('counts a selected member hosting sessions in the authorized group', async () => {
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockMembers.findOneBy.mockResolvedValue({ groupId: GROUP_ID, userId: 'user-2' });
      mockSessions.findBy.mockResolvedValue([{ id: 'session-1' }, { id: 'session-2' }]);
      mockSessionHosts.countBy.mockResolvedValue(2);

      await expect(service.getMemberHostingStats(GROUP_ID, 'user-2', USER_ID))
        .resolves.toEqual({ hostedSessionCount: 2 });
      expect(mockSessionHosts.countBy).toHaveBeenCalledWith({
        userId: 'user-2',
        sessionId: In(['session-1', 'session-2']),
      });
    });

    it('rejects stats for a target who is not a current group member', async () => {
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockMembers.findOneBy.mockResolvedValue(null);

      await expect(service.getMemberHostingStats(GROUP_ID, 'outsider', USER_ID))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockSessions.findBy).not.toHaveBeenCalled();
    });
  });

  describe('removeProposal', () => {
    it('allows the proposal creator to delete a proposal without a linked session', async () => {
      const proposal = baseProposal();
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockSessions.findOneBy.mockResolvedValue(null);

      await service.removeProposal(PROPOSAL_ID, USER_ID);

      expect(mockSessions.findOneBy).toHaveBeenCalledWith({ proposalId: PROPOSAL_ID });
      expect(mockSessions.remove).not.toHaveBeenCalled();
      expect(mockProposals.remove).toHaveBeenCalledWith(proposal);
    });

    it('allows a group admin and deletes the linked session before the proposal', async () => {
      const proposal = { ...baseProposal(), createdBy: 'someone-else' };
      const session = {
        id: 'session-1', groupId: GROUP_ID, playedAt: new Date(),
        notes: null, proposalId: PROPOSAL_ID, createdAt: new Date(),
      };
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockMembers.findOneBy.mockResolvedValue({
        id: 1, userId: USER_ID, groupId: GROUP_ID, role: 'admin', joinedAt: new Date(),
      });
      mockSessions.findOneBy.mockResolvedValue(session);

      await service.removeProposal(PROPOSAL_ID, USER_ID);

      expect(mockSessions.remove).toHaveBeenCalledWith(session);
      expect(mockProposals.remove).toHaveBeenCalledWith(proposal);
      expect(mockSessions.remove.mock.invocationCallOrder[0]).toBeLessThan(
        mockProposals.remove.mock.invocationCallOrder[0],
      );
    });

    it('forbids a plain member who did not create the proposal', async () => {
      mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), createdBy: 'someone-else' });
      mockMembers.findOneBy.mockResolvedValue({
        id: 1, userId: USER_ID, groupId: GROUP_ID, role: 'member', joinedAt: new Date(),
      });

      await expect(service.removeProposal(PROPOSAL_ID, USER_ID))
        .rejects.toBeInstanceOf(ForbiddenException);
      expect(mockSessions.findOneBy).not.toHaveBeenCalled();
      expect(mockProposals.remove).not.toHaveBeenCalled();
    });
  });

  describe('undo', () => {
    it('rejects undo on a cancelled proposal', async () => {
      mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), status: 'cancelled' });

      await expect(service.undo(PROPOSAL_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(mockProposals.save).not.toHaveBeenCalled();
    });
  });
});
