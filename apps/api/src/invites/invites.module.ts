import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invite } from './invite.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';
import { InvitesService } from './invites.service';
import { InvitesController } from './invites.controller';
import { GroupInvitesController } from './group-invites.controller';
import { KeycloakModule } from '../keycloak/keycloak.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // GroupMember and Group are also registered in GroupsModule — TypeORM
    // allows the same entity to be registered via forFeature() in more than
    // one module; each module gets its own scoped repository provider, and
    // this avoids a circular dependency between GroupsModule and
    // InvitesModule that importing GroupsModule directly would create.
    TypeOrmModule.forFeature([Invite, GroupMember, Group]),
    KeycloakModule,
    AuditModule,
  ],
  controllers: [InvitesController, GroupInvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
