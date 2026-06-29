import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BggModule } from '../bgg/bgg.module';
import { GamesService } from './games.service';
import { Game } from './game.entity';

@Module({
  imports: [
    // forFeature([Game]) registers the Game repository in this module's scope.
    // This is what makes @InjectRepository(Game) work in GamesService.
    TypeOrmModule.forFeature([Game]),

    // BggModule exports BggService, so importing it here makes BggService
    // available for injection into GamesService.
    BggModule,
  ],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}
