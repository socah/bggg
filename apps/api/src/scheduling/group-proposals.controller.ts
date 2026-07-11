import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SchedulingService } from './scheduling.service';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { AuthGuard } from '../auth/auth.guard';

interface AuthenticatedRequest {
  user: { sub: string };
}

// Nested under /groups/:groupId — same split as
// GroupInvitesController/InvitesController: creation and listing are
// naturally group-scoped, while everything about a single proposal (below,
// in proposals.controller.ts) is addressed by its own id instead.
@UseGuards(AuthGuard)
@Controller('groups/:groupId/proposals')
export class GroupProposalsController {
  constructor(private readonly schedulingService: SchedulingService) {}

  // POST /groups/:groupId/proposals → 201 Created. Any group member may
  // propose a game night — membership is checked inside the service.
  @Post()
  @HttpCode(201)
  create(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: CreateProposalDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.schedulingService.createProposal(groupId, dto, req.user.sub);
  }

  // GET /groups/:groupId/proposals → 200 OK, newest first.
  @Get()
  findAll(@Param('groupId', ParseUUIDPipe) groupId: string, @Request() req: AuthenticatedRequest) {
    return this.schedulingService.listProposals(groupId, req.user.sub);
  }
}
