import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarFeedToken } from './calendar-feed-token.entity';
import { PlaySession } from '../scheduling/play-session.entity';
import { PlaySessionProposal } from '../scheduling/play-session-proposal.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';

@Module({
  imports: [
    // PlaySession/PlaySessionProposal/GroupMember/Group are ALL registered
    // in other modules too (SchedulingModule, GroupsModule) — TypeORM
    // allows the same entity registered via forFeature() in more than one
    // module; each gets its own scoped repository. CalendarModule reads
    // across groups/sessions/proposals directly rather than going through
    // GroupsService or SchedulingService, since none of their existing
    // methods return "every upcoming session across every group a user
    // belongs to" — that's a cross-group read only this feed needs.
    TypeOrmModule.forFeature([CalendarFeedToken, PlaySession, PlaySessionProposal, GroupMember, Group]),
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
