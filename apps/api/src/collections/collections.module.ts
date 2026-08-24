import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { BggModule } from '../bgg/bgg.module';
import { GamesModule } from '../games/games.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([BggAccount, GameOwnership]),
    // BggModule exports BggService (username verification + collection
    // fetching); GamesModule exports GamesService (catalogue hydration).
    BggModule,
    GamesModule,
  ],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
