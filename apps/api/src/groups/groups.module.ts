import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  // imports: other modules whose exported providers we need inside this module.
  // Empty for now — TypeOrmModule.forFeature([Group]) arrives next topic.
  imports: [],

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
