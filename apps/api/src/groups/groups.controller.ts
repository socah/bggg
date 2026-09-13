import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  ParseUUIDPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AuthGuard } from '../auth/auth.guard';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateMemberNicknameDto } from './dto/update-member-nickname.dto';

// AuthGuard attaches the decoded JWT payload to req.user (see auth.guard.ts).
// Declared here, not imported from 'express', because these handlers only
// ever touch req.user.sub — no need to pull in and extend the full Express
// Request type for one field.
interface AuthenticatedRequest {
  user: { sub: string };
}

// @UseGuards runs AuthGuard before every handler in this controller.
// Any request without a valid JWT never reaches the methods below.
@UseGuards(AuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  // GET /groups → 200 OK with groups owned by the authenticated user only
  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    // req.user is the decoded JWT payload, set by AuthGuard.
    // sub (subject) is the JWT standard claim for the user's unique ID.
    return this.groupsService.findAll(req.user.sub);
  }

  // GET /groups/:id → 200 OK, or 404 if not found, or 403 if not the owner
  // ParseUUIDPipe validates that :id is a well-formed UUID before the
  // service is called — malformed strings never reach the database.
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.groupsService.findOne(id, req.user.sub);
  }

  // GET /groups/:groupId/members → 200 OK with display info, roles, and an
  // isCurrentUser marker for every member. Same 404 (no such group) / 403
  // (not a member) split as findOne, since getMembers reuses it.
  @Get(':groupId/members')
  getMembers(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.getMembers(groupId, req.user.sub);
  }

  @Get(':groupId/members/:userId')
  getMemberProfile(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('userId') userId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.getMemberProfile(groupId, userId, req.user.sub);
  }

  @Patch(':groupId/members/:userId')
  updateMemberRole(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.updateMemberRole(groupId, userId, dto.role, req.user.sub);
  }

  @Patch(':groupId/members/:userId/nickname')
  updateMemberNickname(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberNicknameDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.updateMemberNickname(groupId, userId, dto.nickname, req.user.sub);
  }

  @Delete(':groupId/members/:userId')
  removeMember(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('userId') userId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.removeMember(groupId, userId, req.user.sub);
  }

  // GET /groups/:groupId/games → the group's game library: union of all
  // members' owned games (see GroupsService.getLibrary).
  @Get(':groupId/games')
  getLibrary(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.getLibrary(groupId, req.user.sub);
  }

  // POST /groups → 201 Created. ownerId is set from the token — not the body.
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateGroupDto, @Request() req: AuthenticatedRequest) {
    return this.groupsService.create(dto, req.user.sub);
  }

  // PATCH /groups/:id → 200 OK, or 403 if not the owner
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.groupsService.update(id, dto, req.user.sub);
  }

  // DELETE /groups/:id → 204 No Content, or 403 if not the owner
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: AuthenticatedRequest) {
    return this.groupsService.remove(id, req.user.sub);
  }
}
