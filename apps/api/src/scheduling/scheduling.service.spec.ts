import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SchedulingService } from './scheduling.service';
import { PlaySessionProposal } from './play-session-proposal.entity';
import { PlaySessionRsvp } from './play-session-rsvp.entity';
import { PlaySession } from './play-session.entity';
import { PlaySessionProposalGame } from './play-session-proposal-game.entity';
import { PlaySessionProposalGameVote } from './play-session-proposal-game-vote.entity';
import { GroupMember } from '../groups/group-member.entity';
import { GroupsService } from '../groups/groups.service';

const GROUP_ID = 'group-1';
const PROPOSAL_ID = 'proposal-1';
const USER_ID = 'user-1';

describe('SchedulingService', () => {
  let service: SchedulingService;

  const mockProposals = { findOneBy: jest.fn() };
  const mockRsvps = { findBy: jest.fn() };
  const mockSessions = {};
  const mockProposalGames = { findBy: jest.fn() };
  const mockGameVotes = { countBy: jest.fn() };
  const mockMembers = {};
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
      mockProposals.findOneBy.mockResolvedValue(proposal);
      mockGroupsService.findOne.mockResolvedValue({ id: GROUP_ID });
      mockRsvps.findBy.mockResolvedValue(rsvps);
      mockProposalGames.findBy.mockResolvedValue([proposalGame]);
      mockGameVotes.countBy.mockResolvedValue(2);

      const result = await service.getProposal(PROPOSAL_ID, USER_ID);

      expect(result).toEqual({
        proposal,
        rsvps,
        games: [{ game: proposalGame, voteCount: 2 }],
      });
    });
  });
});
