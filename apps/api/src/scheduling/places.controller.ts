import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { SchedulingService } from './scheduling.service';
import { UpdatePlaceDto } from './dto/update-place.dto';

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

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaceDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.updatePlace(id, dto, req.user.sub);
  }

  @Delete(':id/saved')
  @HttpCode(204)
  removeSaved(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.removeSavedPlace(id, req.user.sub);
  }
}
