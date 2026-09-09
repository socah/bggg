import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game } from '../games/game.entity';
import { GroupsModule } from '../groups/groups.module';
import { GroupMember } from '../groups/group-member.entity';
import { PlaySessionGame } from '../scheduling/play-session-game.entity';
import { PlaySessionProposal } from '../scheduling/play-session-proposal.entity';
import { PlaySessionRsvp } from '../scheduling/play-session-rsvp.entity';
import { PlaySessionProposalGame } from '../scheduling/play-session-proposal-game.entity';
import { PlaySession } from '../scheduling/play-session.entity';
import { GuestPlayer } from './guest-player.entity';
import { PlayResult } from './play-result.entity';
import { PlaySessionPlayer } from './play-session-player.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { UploadsModule } from '../uploads/uploads.module';
import { Place } from '../scheduling/place.entity';
import { PlaceVisibility } from '../scheduling/place-visibility.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Game,
      GroupMember,
      GuestPlayer,
      PlayResult,
      PlaySession,
      PlaySessionGame,
      PlaySessionPlayer,
      PlaySessionProposal,
      PlaySessionRsvp,
      PlaySessionProposalGame,
      Place,
      PlaceVisibility,
    ]),
    GroupsModule,
    UploadsModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
