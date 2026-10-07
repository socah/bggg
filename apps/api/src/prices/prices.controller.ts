import { Controller, Get, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PricesService } from './prices.service';

@Controller('bgg-account/games')
@UseGuards(AuthGuard)
export class PricesController {
  constructor(private readonly prices: PricesService) {}

  @Get(':gameId/prices')
  overview(@Param('gameId', ParseIntPipe) gameId: number) {
    return this.prices.overview(gameId);
  }
}
