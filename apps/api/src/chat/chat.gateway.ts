import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthGuard } from '../auth/auth.guard';
import { ChatService } from './chat.service';
import { JoinChatDto } from './dto/join-chat.dto';
import { SendMessageDto } from './dto/send-message.dto';
import type { Message } from './message.entity';

// @UseGuards(AuthGuard) at the class level applies canActivate to every
// @SubscribeMessage handler below — the exact same guard, same JWKS
// verification, same issuer/algorithm checks as every REST controller.
//
// Decision: guard every message, not just the initial connection.
// NestJS does not route handleConnection() through the guard pipeline at
// all — it's called directly by the Socket.io adapter, not by Nest's
// request/response cycle — so a guard can't intercept "connection accepted"
// the way it intercepts an HTTP request. The alternative would be a
// Socket.io server-level middleware (`server.use(...)` in afterInit) that
// duplicates the JWKS/jwtVerify logic already in AuthGuard. Guarding every
// handler instead means: an unauthenticated socket CAN complete the TCP
// upgrade, but cannot join a room or send a message — every action is
// checked, same as every HTTP request is checked, with no duplicated auth
// code. The cost is a canActivate() call per event instead of per
// connection; negligible, since JWKS is cached after the first fetch.
@UseGuards(AuthGuard)
// Same CORS_ORIGIN env var main.ts uses for the REST API — one source of
// truth for "which frontend origin is allowed to talk to this backend."
@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3000' },
})
export class ChatGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly chatService: ChatService) {}

  @SubscribeMessage('join-chat')
  async handleJoinChat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: JoinChatDto,
  ): Promise<void> {
    const userId = client.data.user.sub;
    const history = await this.chatService.getHistory(data.threadId, userId);
    await client.join(`chat:${data.threadId}`);
    client.emit('chat-history', { threadId: data.threadId, messages: history });
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendMessageDto,
  ): Promise<Message> {
    const userId = client.data.user.sub;
    const message = await this.chatService.saveMessage(data.threadId, userId, data.body);
    const sockets = await this.server.in(`chat:${data.threadId}`).fetchSockets();
    await Promise.all(sockets.map(async (socket) => {
      const recipientId = socket.data.user?.sub;
      if (recipientId && await this.chatService.canAccessThread(data.threadId, recipientId)) {
        socket.emit('new-message', message);
      } else {
        await socket.leave(`chat:${data.threadId}`);
      }
    }));
    return message;
  }
}
