import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaySessionProposal } from './play-session-proposal.entity';
import { PlaySessionRsvp } from './play-session-rsvp.entity';
import { PlaySession } from './play-session.entity';
import { PlaySessionProposalGame } from './play-session-proposal-game.entity';
import { PlaySessionProposalGameVote } from './play-session-proposal-game-vote.entity';
import { GroupMember } from '../groups/group-member.entity';
import { SchedulingService } from './scheduling.service';
import { GroupProposalsController } from './group-proposals.controller';
import { ProposalsController } from './proposals.controller';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlaySessionProposal,
      PlaySessionRsvp,
      PlaySession,
      PlaySessionProposalGame,
      PlaySessionProposalGameVote,
      // Re-registered here for SchedulingService's own role check
      // (assertCanManageProposal) — same "each module gets its own scoped
      // repository for a shared entity" pattern InvitesModule uses for the
      // exact same reason (see invites.module.ts).
      GroupMember,
    ]),
    // Exports GroupsService, which SchedulingService injects for every
    // "is this user a member of this group" check — same pattern
    // ChatModule uses to inject GroupsService into ChatService.
    GroupsModule,
  ],
  controllers: [GroupProposalsController, ProposalsController],
  providers: [SchedulingService],
  // PlaySession is exported so a future module (e.g. a "log a session
  // directly, without a proposal" feature, or CalendarModule reading
  // confirmed sessions) could inject Repository<PlaySession> without
  // SchedulingModule needing to expose a service method for every possible
  // read pattern. Nothing outside this module needs SchedulingService
  // itself yet, so only the TypeOrmModule re-export happens here.
  exports: [TypeOrmModule],
})
export class SchedulingModule {}
