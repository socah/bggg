import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { PlaySessionProposal } from './play-session-proposal.entity';
import { PlaySessionRsvp } from './play-session-rsvp.entity';
import { PlaySession } from './play-session.entity';
import { PlaySessionProposalGame } from './play-session-proposal-game.entity';
import { PlaySessionProposalGameVote } from './play-session-proposal-game-vote.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Game } from '../games/game.entity';
import { GroupsService } from '../groups/groups.service';

const GROUP_ID = 'group-1';
const PROPOSAL_ID = 'proposal-1';
const USER_ID = 'user-1';

describe('SchedulingService', () => {
  let service: SchedulingService;

  const mockProposals = { findOneBy: jest.fn(), save: jest.fn(), remove: jest.fn() };
  const mockRsvps = { findBy: jest.fn() };
  const mockSessions = { findOneBy: jest.fn(), remove: jest.fn() };
  const mockProposalGames = { findBy: jest.fn() };
  const mockGameVotes = { countBy: jest.fn(), existsBy: jest.fn() };
  const mockGames = { findBy: jest.fn() };
  const mockMembers = { findOneBy: jest.fn() };
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

      const result = await service.getProposal(PROPOSAL_ID, USER_ID);

      expect(result).toEqual({
        proposal,
        rsvps,
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
  });

  const baseProposal = (): PlaySessionProposal => ({
    id: PROPOSAL_ID, groupId: GROUP_ID, createdBy: USER_ID, proposedDate: '2026-08-30',
    hostId: null, status: 'collecting', confirmedStart: null, confirmedEnd: null, createdAt: new Date(),
  });

  describe('cancel', () => {
    it('cancels a collecting proposal without touching play_sessions', async () => {
      mockProposals.findOneBy.mockResolvedValue(baseProposal());
      mockProposals.save.mockImplementation(async (p: PlaySessionProposal) => p);

      const result = await service.cancel(PROPOSAL_ID, USER_ID);

      expect(result.status).toBe('cancelled');
      expect(mockSessions.findOneBy).not.toHaveBeenCalled();
    });

    it('deletes the linked session BEFORE flipping a confirmed proposal to cancelled', async () => {
      const proposal = {
        ...baseProposal(),
        status: 'confirmed' as const,
        confirmedStart: new Date('2026-08-30T18:00:00Z'),
        confirmedEnd: new Date('2026-08-30T23:00:00Z'),
      };
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockProposals.save.mockImplementation(async (p: PlaySessionProposal) => p);
      const session = {
        id: 'session-1', groupId: GROUP_ID, playedAt: new Date(),
        notes: null, proposalId: PROPOSAL_ID, createdAt: new Date(),
      };
      mockSessions.findOneBy.mockResolvedValue(session);

      await service.cancel(PROPOSAL_ID, USER_ID);

      expect(mockSessions.remove).toHaveBeenCalledWith(session);
      // Delete-before-flip: the session must be gone before the proposal row
      // loses its 'confirmed' status — same ordering guarantee undo() relies on.
      expect(mockSessions.remove.mock.invocationCallOrder[0]).toBeLessThan(
        mockProposals.save.mock.invocationCallOrder[0],
      );
    });

    it('cancels a confirming proposal without touching play_sessions', async () => {
      mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), status: 'confirming' as const });
      mockProposals.save.mockImplementation(async (p: PlaySessionProposal) => p);

      const result = await service.cancel(PROPOSAL_ID, USER_ID);

      expect(result.status).toBe('cancelled');
      expect(mockSessions.findOneBy).not.toHaveBeenCalled();
    });

    it('rejects cancelling an already-cancelled proposal', async () => {
      mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), status: 'cancelled' });

      await expect(service.cancel(PROPOSAL_ID, USER_ID)).rejects.toBeInstanceOf(ConflictException);
    });

    it('forbids a plain member who is neither creator nor owner/admin', async () => {
      mockProposals.findOneBy.mockResolvedValue({ ...baseProposal(), createdBy: 'someone-else' });
      mockMembers.findOneBy.mockResolvedValue({
        id: 1, userId: USER_ID, groupId: GROUP_ID, role: 'member', joinedAt: new Date(),
      });

      await expect(service.cancel(PROPOSAL_ID, USER_ID)).rejects.toBeInstanceOf(ForbiddenException);
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
