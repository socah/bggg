import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  HttpCode,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ChatService } from './chat.service';

interface AuthenticatedRequest {
  user: { sub: string };
}

@UseGuards(AuthGuard)
@Controller('groups/:groupId/chats')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.chatService.listThreads(groupId, request.user.sub);
  }

  @Post('proposals/:proposalId')
  proposal(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.chatService.getOrCreateProposalThread(groupId, proposalId, request.user.sub);
  }
}

@UseGuards(AuthGuard)
@Controller('chats')
export class DirectChatsController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.chatService.listDirectThreads(request.user.sub);
  }

  @Post('direct/:userId')
  direct(@Param('userId') userId: string, @Request() request: AuthenticatedRequest) {
    return this.chatService.getOrCreateDirectThread(request.user.sub, userId);
  }

  @Delete(':threadId')
  @HttpCode(204)
  remove(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.chatService.removeDirectThread(threadId, request.user.sub);
  }
}
