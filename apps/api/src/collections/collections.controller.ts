import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  HttpCode,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { LinkBggAccountDto } from './dto/link-bgg-account.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AddGameDto } from './dto/add-game.dto';
import { UpsertReviewDto } from './dto/upsert-review.dto';
import { UpdateWishlistPriorityDto } from './dto/update-wishlist-priority.dto';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';
import { AddListGameDto } from './dto/add-list-game.dto';
import { UpdateListGameDto } from './dto/update-list-game.dto';

// Same local-interface convention every other controller in this repo uses
// (GroupsController, InvitesController, UploadsController, ...) instead of
// a shared type — these handlers only ever touch req.user.sub.
interface AuthenticatedRequest {
  user: { sub: string };
}

@UseGuards(AuthGuard)
@Controller('bgg-account')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  // GET /bgg-account → { account }, where account is the current link or
  // null if none. Wrapped in an envelope rather than returning the account
  // (or null) directly: NestJS's Express adapter serializes a null handler
  // result as an EMPTY 200 body, which would break clients calling
  // response.json() on it.
  @Get()
  async getAccount(@Request() req: AuthenticatedRequest) {
    return { account: await this.collectionsService.getAccount(req.user.sub) };
  }

  // POST /bgg-account → 200 OK, upserts the link (create or re-link)
  @Post()
  @HttpCode(200)
  linkAccount(@Body() dto: LinkBggAccountDto, @Request() req: AuthenticatedRequest) {
    return this.collectionsService.linkAccount(req.user.sub, dto.bggUsername);
  }

  // DELETE /bgg-account → 204 No Content. GameOwnership rows are kept.
  @Delete()
  @HttpCode(204)
  async unlinkAccount(@Request() req: AuthenticatedRequest) {
    await this.collectionsService.unlinkAccount(req.user.sub);
  }

  // POST /bgg-account/import → 200 OK with { added, removed, total }
  @Post('import')
  @HttpCode(200)
  importCollection(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.importCollection(req.user.sub);
  }

  // GET /bgg-account/games → this user's owned games, joined with Game data
  @Get('games')
  getOwnedGames(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.getOwnedGames(req.user.sub);
  }

  @Get('wishlist')
  getWishlistGames(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.getWishlistGames(req.user.sub);
  }

  @Get('saved')
  getSavedGames(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.getSavedGames(req.user.sub);
  }

  @Get('search')
  searchGames(@Query('q') query: string) {
    return this.collectionsService.searchGames(query ?? '');
  }

  @Post('games')
  addOwnedGame(@Body() dto: AddGameDto, @Request() req: AuthenticatedRequest) {
    return this.collectionsService.addOwnedGame(req.user.sub, dto.bggId);
  }

  @Delete('games/:gameId')
  @HttpCode(204)
  async removeOwnedGame(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.collectionsService.removeOwnedGame(req.user.sub, gameId);
  }

  @Post('wishlist')
  addWishlistGame(@Body() dto: AddGameDto, @Request() req: AuthenticatedRequest) {
    return this.collectionsService.addWishlistGame(req.user.sub, dto.bggId);
  }

  @Post('saved')
  addSavedGame(@Body() dto: AddGameDto, @Request() req: AuthenticatedRequest) {
    return this.collectionsService.addSavedGame(req.user.sub, dto.bggId);
  }

  @Delete('wishlist/:gameId')
  @HttpCode(204)
  async removeWishlistGame(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.collectionsService.removeWishlistGame(req.user.sub, gameId);
  }

  @Delete('saved/:gameId')
  @HttpCode(204)
  async removeSavedGame(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.collectionsService.removeSavedGame(req.user.sub, gameId);
  }

  @Patch('wishlist/:gameId')
  updateWishlistPriority(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Body() dto: UpdateWishlistPriorityDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.collectionsService.updateWishlistPriority(
      req.user.sub,
      gameId,
      dto.wishlistPriority,
    );
  }

  @Get('lists')
  getLists(@Request() req: AuthenticatedRequest) {
    return this.collectionsService.getLists(req.user.sub);
  }

  @Post('lists')
  createList(@Body() dto: CreateListDto, @Request() req: AuthenticatedRequest) {
    return this.collectionsService.createList(req.user.sub, dto);
  }

  @Patch('lists/:id')
  updateList(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.collectionsService.updateList(req.user.sub, id, dto);
  }

  @Delete('lists/:id')
  @HttpCode(204)
  async removeList(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.collectionsService.removeList(req.user.sub, id);
  }

  @Post('lists/:id/games')
  addListGame(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddListGameDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.collectionsService.addListGame(req.user.sub, id, dto);
  }

  @Patch('lists/:id/games/:gameId')
  updateListGame(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gameId', ParseIntPipe) gameId: number,
    @Body() dto: UpdateListGameDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.collectionsService.updateListGame(req.user.sub, id, gameId, dto);
  }

  @Delete('lists/:id/games/:gameId')
  @HttpCode(204)
  async removeListGame(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gameId', ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.collectionsService.removeListGame(req.user.sub, id, gameId);
  }

  @Get('games/:gameId/details')
  getGameDetails(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.collectionsService.getGameDetails(req.user.sub, gameId);
  }

  @Put('games/:gameId/review')
  upsertReview(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Body() dto: UpsertReviewDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.collectionsService.upsertReview(req.user.sub, gameId, dto);
  }

  @Delete('games/:gameId/review')
  @HttpCode(204)
  async removeReview(
    @Param('gameId', ParseIntPipe) gameId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    await this.collectionsService.removeReview(req.user.sub, gameId);
  }
}
