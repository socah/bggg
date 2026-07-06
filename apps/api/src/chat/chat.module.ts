import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message]),
    // GroupsModule exports GroupsService (see groups.module.ts) — importing
    // it here is what makes GroupsService injectable into ChatService.
    GroupsModule,
  ],
  // No controllers: chat has no REST routes, only the gateway's socket
  // events. providers is where a Gateway class lives — NestJS treats it
  // like any other injectable, not like a controller.
  providers: [ChatService, ChatGateway],
})
export class ChatModule {}
