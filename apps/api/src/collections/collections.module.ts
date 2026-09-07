import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';
import { BggModule } from '../bgg/bgg.module';
import { GamesModule } from '../games/games.module';
import { GameWishlist } from './game-wishlist.entity';
import { GameSaved } from './game-saved.entity';
import { Review } from './review.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';
import { PlaySession } from '../scheduling/play-session.entity';
import { PlaySessionGame } from '../scheduling/play-session-game.entity';
import { KeycloakModule } from '../keycloak/keycloak.module';
import { PersonalList } from './personal-list.entity';
import { PersonalListItem } from './personal-list-item.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BggAccount,
      GameOwnership,
      GameWishlist,
      GameSaved,
      Review,
      GroupMember,
      Group,
      PlaySession,
      PlaySessionGame,
      PersonalList,
      PersonalListItem,
    ]),
    // BggModule exports BggService (username verification + collection
    // fetching); GamesModule exports GamesService (catalogue hydration).
    BggModule,
    GamesModule,
    KeycloakModule,
  ],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
