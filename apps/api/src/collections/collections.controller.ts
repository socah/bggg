import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  HttpCode,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CollectionsService } from './collections.service';
import { LinkBggAccountDto } from './dto/link-bgg-account.dto';
import { AuthGuard } from '../auth/auth.guard';

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
}
