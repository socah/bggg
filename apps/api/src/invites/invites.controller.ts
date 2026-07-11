import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  UseGuards,
  Request,
} from '@nestjs/common';
import { InvitesService } from './invites.service';
import { RegisterInviteDto } from './dto/register-invite.dto';
import { AuthGuard } from '../auth/auth.guard';

interface AuthenticatedRequest {
  user: { sub: string };
}

// No class-level @UseGuards here — unlike GroupsController or
// GroupInvitesController, this controller deliberately mixes public routes
// (preview, register) with one authenticated route (accept). The guard is
// applied per-method below instead of blanket over the whole controller.
@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  // GET /invites/:token → 200 OK with a preview, or 404/410 if invalid.
  // Public and read-only — does not consume the invite. :token is the raw
  // token from the URL, never looked up as a database id directly.
  @Get(':token')
  preview(@Param('token') token: string) {
    return this.invitesService.previewInvite(token);
  }

  // POST /invites/:token/register → 201 Created. Public — Path B (Decision 4
  // in notes/3_invite_system.md): creates a brand-new Keycloak account and
  // joins the group in one step. No AuthGuard: there is no JWT yet for it
  // to check. The invite token is the only gate on this endpoint.
  @Post(':token/register')
  @HttpCode(201)
  register(@Param('token') token: string, @Body() dto: RegisterInviteDto) {
    return this.invitesService.registerAndAcceptInvite(token, dto);
  }

  // POST /invites/:token/accept → 200 OK. Authenticated — Path A: the
  // invitee already has a Keycloak account, verified by AuthGuard before
  // this handler runs at all.
  @UseGuards(AuthGuard)
  @Post(':token/accept')
  accept(@Param('token') token: string, @Request() req: AuthenticatedRequest) {
    return this.invitesService.acceptInvite(token, req.user.sub);
  }
}
