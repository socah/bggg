import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Request, UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { AuthGuard } from '../auth/auth.guard';

// Same pattern as GroupsController: req.user is populated by AuthGuard,
// declared narrowly here since these handlers only read `.sub`.
interface AuthenticatedRequest {
  user: { sub: string };
}

@UseGuards(AuthGuard)
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  // POST /uploads/presign → 200 OK with a short-lived signed PUT URL.
  // The client uploads the actual file bytes directly to the returned
  // `url` — this endpoint never receives them.
  @Post('presign')
  presign(@Body() dto: PresignUploadDto, @Request() req: AuthenticatedRequest) {
    return this.uploadsService.presign(req.user.sub, dto);
  }

  // POST /uploads/confirm → 201 Created once the client has PUT the file to
  // R2 and reports back. This is what actually writes the play_photos row.
  @Post('confirm')
  @HttpCode(201)
  confirm(@Body() dto: ConfirmUploadDto, @Request() req: AuthenticatedRequest) {
    return this.uploadsService.confirm(req.user.sub, dto);
  }

  @Get('plays/:playId')
  listForPlay(@Param('playId', ParseUUIDPipe) playId: string, @Request() req: AuthenticatedRequest) {
    return this.uploadsService.listForPlay(req.user.sub, playId);
  }
}
