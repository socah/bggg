import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { RsvpDto } from './dto/rsvp.dto';
import { LockInDto } from './dto/lock-in.dto';
import { ProposeGameDto } from './dto/propose-game.dto';
import { SuggestPlaceDto } from './dto/suggest-place.dto';
import { AuthGuard } from '../auth/auth.guard';

interface AuthenticatedRequest {
  user: { sub: string };
}

// Everything scoped to a single, already-created proposal. Authenticated
// throughout — unlike InvitesController, there's no unauthenticated path
// here at all (no equivalent of "register a brand new account via a link").
@UseGuards(AuthGuard)
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly schedulingService: SchedulingService) {}

  // GET /proposals/:id → the proposal, every RSVP on it, and every proposed
  // game with its derived vote count.
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.getProposal(id, req.user.sub);
  }

  // DELETE /proposals/:id → 204 No Content. The service restricts this to
  // the proposal creator or a group owner/admin.
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.removeProposal(id, req.user.sub);
  }

  // PUT /proposals/:id/rsvp → 200 OK. Upsert: this is always "set my
  // current answer", whether it's the first RSVP or the fifth change of
  // mind — see SchedulingService.rsvp.
  @Put(':id/rsvp')
  rsvp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RsvpDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.rsvp(id, dto, req.user.sub);
  }

  // PATCH /proposals/:id/rsvp/lock-in → lock in (or withdraw a lock-in)
  // during the 'confirming' stage. Acts on the CALLER's own RSVP only —
  // there's no way to lock in on someone else's behalf.
  @Patch(':id/rsvp/lock-in')
  lockIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LockInDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.lockIn(id, req.user.sub, dto.confirmed);
  }

  // POST /proposals/:id/request-confirmation → 'collecting' -> 'confirming'.
  @Post(':id/request-confirmation')
  requestConfirmation(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.requestConfirmation(id, req.user.sub);
  }

  // POST /proposals/:id/finalize → 'confirming' -> 'confirmed'; creates the
  // play_sessions row.
  @Post(':id/finalize')
  finalize(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.finalize(id, req.user.sub);
  }

  // POST /proposals/:id/undo → rolls back to 'collecting' from either
  // 'confirming' or 'confirmed'.
  @Post(':id/undo')
  undo(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.undo(id, req.user.sub);
  }

  // POST /proposals/:id/games → 201 Created, or returns the existing row if
  // this game was already proposed (see SchedulingService.proposeGame).
  @Post(':id/games')
  @HttpCode(201)
  proposeGame(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProposeGameDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.proposeGame(id, dto, req.user.sub);
  }

  // GET /proposals/:id/games → each proposed game with its derived vote
  // count (Decision E — never a stored counter).
  @Get(':id/games')
  listGames(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.listProposalGames(id, req.user.sub);
  }

  // POST /proposals/:id/games/:proposalGameId/votes → 204, idempotent
  // (voting twice is a no-op, not an error).
  @Post(':id/games/:proposalGameId/votes')
  @HttpCode(204)
  voteForGame(
    @Param('proposalGameId', ParseUUIDPipe) proposalGameId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.voteForGame(proposalGameId, req.user.sub);
  }

  // DELETE /proposals/:id/games/:proposalGameId/votes → 204, idempotent.
  @Delete(':id/games/:proposalGameId/votes')
  @HttpCode(204)
  unvoteForGame(
    @Param('proposalGameId', ParseUUIDPipe) proposalGameId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.unvoteForGame(proposalGameId, req.user.sub);
  }

  @Get(':id/places')
  listPlaces(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.listProposalPlaces(id, req.user.sub);
  }

  @Post(':id/places')
  @HttpCode(201)
  suggestPlace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuggestPlaceDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.suggestPlace(id, dto, req.user.sub);
  }

  @Get(':id/places/available')
  listAvailablePlaces(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.listAvailablePlaces(id, req.user.sub);
  }

  @Post(':id/places/:proposalPlaceId/votes')
  @HttpCode(204)
  voteForPlace(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('proposalPlaceId', ParseUUIDPipe) proposalPlaceId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.voteForPlace(id, proposalPlaceId, req.user.sub);
  }

  @Delete(':id/places/:proposalPlaceId/votes')
  @HttpCode(204)
  unvoteForPlace(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('proposalPlaceId', ParseUUIDPipe) proposalPlaceId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.unvoteForPlace(id, proposalPlaceId, req.user.sub);
  }

  @Put(':id/places/:proposalPlaceId/ownership')
  @HttpCode(204)
  markPlaceOwned(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('proposalPlaceId', ParseUUIDPipe) proposalPlaceId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.markPlaceOwned(id, proposalPlaceId, req.user.sub);
  }

  @Delete(':id/places/:proposalPlaceId/ownership')
  @HttpCode(204)
  unmarkPlaceOwned(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('proposalPlaceId', ParseUUIDPipe) proposalPlaceId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.unmarkPlaceOwned(id, proposalPlaceId, req.user.sub);
  }
}
