import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CreateGuestPlayerDto } from './dto/create-guest-player.dto';
import { CreatePlayDto } from './dto/create-play.dto';
import { LinkGuestPlayerDto } from './dto/link-guest-player.dto';
import { SessionsService } from './sessions.service';
import { UpdatePlayDto } from './dto/update-play.dto';
import { UpdateSessionPlaceDto } from './dto/update-session-place.dto';
import { PlayPlayersQueryDto } from './dto/play-players-query.dto';

interface AuthenticatedRequest {
  user: { sub: string };
}

@UseGuards(AuthGuard)
@Controller('groups/:groupId')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get('play-players')
  listPlayers(@Param('groupId', ParseUUIDPipe) groupId: string, @Query() query: PlayPlayersQueryDto, @Request() req: AuthenticatedRequest) {
    return this.sessionsService.listPlayers(groupId, req.user.sub, query);
  }

  @Post('guest-players')
  createGuest(@Param('groupId', ParseUUIDPipe) groupId: string, @Body() dto: CreateGuestPlayerDto, @Request() req: AuthenticatedRequest) {
    return this.sessionsService.createGuest(groupId, dto, req.user.sub);
  }

  @Patch('guest-players/:guestId/link')
  linkGuest(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Body() dto: LinkGuestPlayerDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionsService.linkGuest(groupId, guestId, dto, req.user.sub);
  }

  @Delete('guest-players/:guestId')
  @HttpCode(204)
  removeGuest(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('guestId', ParseUUIDPipe) guestId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionsService.removeGuest(groupId, guestId, req.user.sub);
  }

  @Post('plays')
  createPlay(@Param('groupId', ParseUUIDPipe) groupId: string, @Body() dto: CreatePlayDto, @Request() req: AuthenticatedRequest) {
    return this.sessionsService.createPlay(groupId, dto, req.user.sub);
  }

  @Get('plays')
  listPlays(@Param('groupId', ParseUUIDPipe) groupId: string, @Request() req: AuthenticatedRequest) {
    return this.sessionsService.listPlays(groupId, req.user.sub);
  }

  @Patch('sessions/:sessionId/place')
  updateSessionPlace(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateSessionPlaceDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionsService.updateSessionPlace(groupId, sessionId, dto, req.user.sub);
  }

  @Get('plays/:playId')
  getPlay(@Param('groupId', ParseUUIDPipe) groupId: string, @Param('playId', ParseUUIDPipe) playId: string, @Request() req: AuthenticatedRequest) {
    return this.sessionsService.getPlay(groupId, playId, req.user.sub);
  }

  @Patch('plays/:playId')
  updatePlay(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('playId', ParseUUIDPipe) playId: string,
    @Body() dto: UpdatePlayDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionsService.updatePlay(groupId, playId, dto, req.user.sub);
  }

  @Delete('plays/:playId')
  @HttpCode(204)
  removePlay(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('playId', ParseUUIDPipe) playId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.sessionsService.removePlay(groupId, playId, req.user.sub);
  }
}
