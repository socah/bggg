import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BggModule } from '../bgg/bgg.module';
import { PricesService } from './prices.service';
import { PricesController } from './prices.controller';
import { GamePriceHistory, GamePriceSource } from './game-price.entity';
import { Game } from '../games/game.entity';
import { GameMarketExclusion } from './game-market-exclusion.entity';

@Module({
  imports: [BggModule, TypeOrmModule.forFeature([Game, GamePriceSource, GamePriceHistory, GameMarketExclusion]), HttpModule.register({ timeout: 10000 })],
  providers: [PricesService],
  controllers: [PricesController],
})
export class PricesModule {}
