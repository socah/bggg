import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group } from './group.entity';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  // TypeOrmModule.forFeature([Group]) registers Repository<Group> for injection
  // within this module. Without this, @InjectRepository(Group) in GroupsService
  // would throw at startup.
  imports: [TypeOrmModule.forFeature([Group])],

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
