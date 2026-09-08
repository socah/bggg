import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SchedulingService } from './scheduling.service';

interface AuthenticatedRequest {
  user: { sub: string };
}

@UseGuards(AuthGuard)
@Controller('places')
export class PlacesController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get('saved')
  listSaved(@Request() req: AuthenticatedRequest) {
    return this.schedulingService.listAvailablePlaces(req.user.sub);
  }

  @Delete(':id/saved')
  @HttpCode(204)
  removeSaved(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.removeSavedPlace(id, req.user.sub);
  }
}
