import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from '../groups/group-member.entity';
import { NotificationPreferences } from './notification-preferences.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushSubscriptionRecord } from './push-subscription.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscriptionRecord, NotificationPreferences, GroupMember])],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
