import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationsService } from './notifications.service';
import { RemovePushSubscriptionDto } from './dto/remove-push-subscription.dto';
import { SavePushSubscriptionDto } from './dto/save-push-subscription.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

interface AuthenticatedRequest { user: { sub: string } }

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('configuration')
  getConfiguration() {
    return this.notifications.getConfiguration();
  }

  @Get('preferences')
  getPreferences(@Request() request: AuthenticatedRequest) {
    return this.notifications.getPreferences(request.user.sub);
  }

  @Patch('preferences')
  updatePreferences(@Request() request: AuthenticatedRequest, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.notifications.updatePreferences(request.user.sub, dto);
  }

  @Post('subscriptions')
  @HttpCode(204)
  saveSubscription(@Request() request: AuthenticatedRequest, @Body() dto: SavePushSubscriptionDto) {
    return this.notifications.saveSubscription(request.user.sub, dto);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  removeSubscription(@Request() request: AuthenticatedRequest, @Body() dto: RemovePushSubscriptionDto) {
    return this.notifications.removeSubscription(request.user.sub, dto.endpoint);
  }
}
