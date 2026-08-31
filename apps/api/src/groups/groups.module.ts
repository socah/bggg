import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from './group.entity';
import { GroupMember } from './group-member.entity';
import { GameOwnership } from '../collections/game-ownership.entity';
import { Game } from '../games/game.entity';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { AuditModule } from '../audit/audit.module';
import { KeycloakModule } from '../keycloak/keycloak.module';

@Module({
  // TypeOrmModule.forFeature([Group, GroupMember, GameOwnership, Game])
  // registers repositories for Group, GroupMember, GameOwnership, and Game
  // for injection within this module (GameOwnership/Game following the same
  // shared-entity registration pattern as GroupMember elsewhere). Without
  // this, @InjectRepository(...) for any of them in GroupsService would throw
  // at startup. GroupMember is also registered in InvitesModule — see the
  // comment there for why that's fine, not a conflict.
  // KeycloakModule provides KeycloakAdminClient, used by getMembers() to
  // resolve member subs to display names. No circular dependency:
  // KeycloakModule never imports GroupsModule — same reasoning already
  // documented in invites.module.ts.
  imports: [
    TypeOrmModule.forFeature([Group, GroupMember, GameOwnership, Game]),
    AuditModule,
    KeycloakModule,
  ],

  // controllers: NestJS instantiates these and registers their routes.
  controllers: [GroupsController],

  // providers: classes available for injection within this module.
  // Listing GroupsService here is what allows the controller to receive it.
  providers: [GroupsService],

  // exports: providers other modules can inject after importing GroupsModule.
  // Exporting GroupsService now means a future InvitesModule or StatsModule
  // can call groupsService.findOne() without re-declaring the service.
  exports: [GroupsService],
})
export class GroupsModule {}
