import { UseGuards } from '@nestjs/common';
import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthGuard } from '../auth/auth.guard';
import { ChatService } from './chat.service';

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
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN } })
export class ChatGateway {
  constructor(private readonly chatService: ChatService) {}

  @SubscribeMessage('join-group')
  async handleJoinGroup(
    @ConnectedSocket() client: Socket,
    @MessageBody() groupId: string,
  ): Promise<void> {
    // client.data.user was set by AuthGuard.canActivate — see auth.guard.ts.
    // .sub is the JWT subject claim: the stable user id.
    const userId = client.data.user.sub;

    // getHistory() calls groupsService.findOne(groupId, userId) internally,
    // which throws ForbiddenException if this user doesn't own the group.
    // That exception propagates out of this handler and NestJS's WsException
    // filter turns it into an error event on the socket — the join never
    // happens, and socket.join() below is never reached for an unauthorised
    // group id. This is the authorization check: proving identity (the
    // guard) is not the same as proving access to THIS group (this call).
    const history = await this.chatService.getHistory(groupId, userId);

    client.join(`group:${groupId}`);
    client.emit('chat-history', history);
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: string; body: string },
  ): Promise<void> {
    const userId = client.data.user.sub;

    // saveMessage() re-checks group access (see chat.service.ts) — a client
    // could technically emit 'send-message' for a group it never joined a
    // room for, so this check cannot be skipped just because join-group
    // already ran once earlier in the connection's lifetime.
    const message = await this.chatService.saveMessage(
      data.groupId,
      userId,
      data.body,
    );

    // io.to(room) is reached via client.to() here: broadcasts to every
    // OTHER socket in the room, not back to the sender (which already has
    // the message locally). Using client.server.to() instead would also
    // echo it back to the sender — a UX choice, not a security one.
    client.to(`group:${data.groupId}`).emit('new-message', message);
  }
}
