import { Controller, Get, Param, ParseUUIDPipe, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SchedulingService } from './scheduling.service';

interface AuthenticatedRequest {
  user: { sub: string };
}

@UseGuards(AuthGuard)
@Controller()
export class HostingStatsController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get('users/me/hosting-stats')
  getMyHostingStats(@Request() req: AuthenticatedRequest) {
    return this.schedulingService.getMyHostingStats(req.user.sub);
  }

  @Get('groups/:groupId/hosting-stats')
  getGroupHostingStats(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.getGroupHostingStats(groupId, req.user.sub);
  }
}
