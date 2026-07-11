import {
  Controller,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { AuthGuard } from '../auth/auth.guard';

interface AuthenticatedRequest {
  user: { sub: string };
}

// Nested under /groups/:groupId — separate controller from InvitesController
// because this route is fully authenticated (owner/admin only), unlike most
// of what lives under plain /invites.
@UseGuards(AuthGuard)
@Controller('groups/:groupId/invites')
export class GroupInvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  // POST /groups/:groupId/invites → 201 Created, or 403 if the caller isn't
  // an owner/admin of this group. Role check happens inside the service,
  // same pattern as GroupsService.findOne's ownership check.
  @Post()
  create(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: CreateInviteDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.invitesService.createInvite(groupId, dto.role, req.user.sub);
  }
}
