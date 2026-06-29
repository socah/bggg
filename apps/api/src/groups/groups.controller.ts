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

// @UseGuards runs AuthGuard before every handler in this controller.
// Any request without a valid JWT never reaches the methods below.
@UseGuards(AuthGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  // GET /groups → 200 OK with groups owned by the authenticated user only
  @Get()
  findAll(@Request() req) {
    // req.user is the decoded JWT payload, set by AuthGuard.
    // sub (subject) is the JWT standard claim for the user's unique ID.
    return this.groupsService.findAll(req.user.sub);
  }

  // GET /groups/:id → 200 OK, or 404 if not found, or 403 if not the owner
  // ParseUUIDPipe validates that :id is a well-formed UUID before the
  // service is called — malformed strings never reach the database.
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.groupsService.findOne(id, req.user.sub);
  }

  // POST /groups → 201 Created. ownerId is set from the token — not the body.
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateGroupDto, @Request() req) {
    return this.groupsService.create(dto, req.user.sub);
  }

  // PATCH /groups/:id → 200 OK, or 403 if not the owner
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
    @Request() req,
  ) {
    return this.groupsService.update(id, dto, req.user.sub);
  }

  // DELETE /groups/:id → 204 No Content, or 403 if not the owner
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    this.groupsService.remove(id, req.user.sub);
  }
}
