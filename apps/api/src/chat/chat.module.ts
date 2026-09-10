import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { GroupsModule } from '../groups/groups.module';
import { ChatThread } from './chat-thread.entity';
import { PlaySessionProposal } from '../scheduling/play-session-proposal.entity';
import { ChatController, DirectChatsController } from './chat.controller';
import { ChatThreadDismissal } from './chat-thread-dismissal.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, ChatThread, ChatThreadDismissal, PlaySessionProposal]),
    // GroupsModule exports GroupsService (see groups.module.ts) — importing
    // it here is what makes GroupsService injectable into ChatService.
    GroupsModule,
    NotificationsModule,
  ],
  controllers: [ChatController, DirectChatsController],
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
