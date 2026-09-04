import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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

const GROUP_ID = 'group-1';
const PROPOSAL_ID = 'proposal-1';
const USER_ID = 'user-1';

describe('SchedulingService', () => {
  let service: SchedulingService;

  const mockProposals = { findOneBy: jest.fn(), findBy: jest.fn(), save: jest.fn(), remove: jest.fn() };
  const mockRsvps = { findBy: jest.fn() };
  const mockSessions = {
    findOneBy: jest.fn(), remove: jest.fn(), create: jest.fn(), save: jest.fn(), countBy: jest.fn(),
  };
  const mockProposalGames = { findBy: jest.fn() };
  const mockGameVotes = { countBy: jest.fn(), existsBy: jest.fn() };
  const mockGames = { findBy: jest.fn() };
  const mockPlaces = { findOneBy: jest.fn(), findBy: jest.fn(), create: jest.fn(), save: jest.fn() };
  const mockPlaceOwners = { findBy: jest.fn(), upsert: jest.fn(), delete: jest.fn() };
  const mockPlaceVisibility = { findBy: jest.fn(), upsert: jest.fn() };
  const mockProposalPlaces = {
    findBy: jest.fn(), findOneBy: jest.fn(), countBy: jest.fn(), create: jest.fn(), save: jest.fn(),
  };
  const mockPlaceVotes = {
    countBy: jest.fn(), existsBy: jest.fn(), create: jest.fn(), save: jest.fn(), delete: jest.fn(),
  };
  const mockSessionHosts = {
    create: jest.fn(), save: jest.fn(), countBy: jest.fn(), createQueryBuilder: jest.fn(),
  };
  const mockMembers = { findOneBy: jest.fn(), findBy: jest.fn() };
  const mockGroupsService = { findOne: jest.fn() };

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
        { provide: getRepositoryToken(GroupMember), useValue: mockMembers },
        { provide: GroupsService, useValue: mockGroupsService },
      ],
    }).compile();

    service = module.get<SchedulingService>(SchedulingService);
  });

  afterEach(() => jest.clearAllMocks());

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
      mockGameVotes.countBy.mockResolvedValue(2);
      // The requesting user has NOT voted on this game.
      mockGameVotes.existsBy.mockResolvedValue(false);
      mockProposalPlaces.findBy.mockResolvedValue([]);

      const result = await service.getProposal(PROPOSAL_ID, USER_ID);

      expect(result).toEqual({
        proposal,
        rsvps,
        canManage: true,
        places: [],
        games: [{
          proposalGameId: 'pg-1',
          game: { id: 42, name: 'Gloomhaven' },
          voteCount: 2,
          votedByMe: false,
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
      mockGameVotes.countBy.mockResolvedValue(3);
      mockGameVotes.existsBy.mockResolvedValue(true);

      const result = await service.listProposalGames(PROPOSAL_ID, USER_ID);

      expect(result).toEqual([{
        proposalGameId: 'pg-1',
        game: { id: 42, name: 'Gloomhaven' },
        voteCount: 3,
        votedByMe: true,
      }]);
      expect(mockGameVotes.existsBy).toHaveBeenCalledWith({ proposalGameId: 'pg-1', userId: USER_ID });
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
      mockGameVotes.countBy
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(3);
      mockGameVotes.existsBy.mockResolvedValue(false);

      const result = await service.listProposalGames(PROPOSAL_ID, USER_ID);

      expect(result.map((row) => row.game.name)).toEqual(['Azul', 'Brass', 'Catan']);
    });
  });

  const baseProposal = (): PlaySessionProposal => ({
    id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-30',
    hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
  });

  describe('places', () => {
    it('synchronizes newly accessible places and sorts owned places before global frequency', async () => {
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockPlaceOwners.findBy.mockResolvedValue([{ placeId: 'owned', userId: USER_ID }]);
      mockPlaceVisibility.findBy.mockResolvedValue([{ placeId: 'seen', userId: USER_ID }]);
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

      const result = await service.listAvailablePlaces(PROPOSAL_ID, USER_ID);

      expect(result.map((row) => row.place.id)).toEqual(['owned', 'discovered', 'seen']);
      expect(mockPlaceVisibility.upsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          { placeId: 'owned', userId: USER_ID },
          { placeId: 'discovered', userId: USER_ID },
        ]),
        ['placeId', 'userId'],
      );
    });

    it('rejects a nested place action when the join row belongs to another proposal', async () => {
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockProposalPlaces.findOneBy.mockResolvedValue(null);

      await expect(service.voteForPlace(PROPOSAL_ID, 'other-row', USER_ID))
        .rejects.toBeInstanceOf(NotFoundException);
      expect(mockProposalPlaces.findOneBy).toHaveBeenCalledWith({
        id: 'other-row',
        proposalId: PROPOSAL_ID,
      });
      expect(mockPlaceVotes.save).not.toHaveBeenCalled();
    });
  });

  describe('requestConfirmation', () => {
    it('derives all hosts from owners of places suggested on the proposal', async () => {
      const proposal = baseProposal();
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockProposals.save.mockImplementation(async (value: PlaySessionProposal) => value);
      mockRsvps.findBy.mockResolvedValue([
        { userId: 'host-1', availableStart: new Date('2026-08-30T10:00:00Z'), availableEnd: new Date('2026-08-30T12:00:00Z') },
        { userId: 'guest', availableStart: new Date('2026-08-30T11:00:00Z'), availableEnd: new Date('2026-08-30T13:00:00Z') },
      ]);
      mockProposalPlaces.findBy.mockResolvedValue([{ placeId: 'place-1' }]);
      mockPlaceOwners.findBy.mockResolvedValue([{ placeId: 'place-1', userId: 'host-1' }]);

      const result = await service.requestConfirmation(PROPOSAL_ID, USER_ID);

      expect(result.status).toBe('confirming');
      expect(result.confirmedStart).toEqual(new Date('2026-08-30T11:00:00Z'));
      expect(result.confirmedEnd).toEqual(new Date('2026-08-30T12:00:00Z'));
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
