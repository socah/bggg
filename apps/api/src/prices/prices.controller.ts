import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PricesService } from './prices.service';
import { ExcludeMarketListingDto } from './exclude-market-listing.dto';

@Controller('bgg-account')
@UseGuards(AuthGuard)
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get('games/:gameId/prices')
  overview(@Param('gameId', ParseIntPipe) gameId: number) {
    return this.prices.overview(gameId);
  }

  @Post('games/:gameId/prices/market-exclusions')
  @HttpCode(200)
  excludeListing(@Param('gameId', ParseIntPipe) gameId: number, @Body() dto: ExcludeMarketListingDto) {
    return this.prices.excludeMarketListing(gameId, dto.url);
  }

  @Get('collection-stats')
  collectionStats(@Request() request: { user: { sub: string } }) {
    return this.prices.collectionStats(request.user.sub);
  }
}
