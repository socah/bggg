import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  ParseIntPipe,
} from '@nestjs/common';
import { GroupsService, CreateGroupDto, UpdateGroupDto } from './groups.service';

// @Controller('groups') means every method in this class lives under /groups.
// The controller's only job is to translate HTTP in/out — no business logic here.
@Controller('groups')
export class GroupsController {
  // NestJS injects the GroupsService singleton automatically.
  constructor(private readonly groupsService: GroupsService) {}

  // GET /groups → 200 OK with array of groups
  @Get()
  findAll() {
    return this.groupsService.findAll();
  }

  // GET /groups/:id → 200 OK with one group, or 404 if not found
  // ParseIntPipe converts the route param string "1" to the number 1.
  // Without it, `id` is a string and `findOne("1" === 1)` would be false.
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.groupsService.findOne(id);
  }

  // POST /groups → 201 Created with the new group
  // NestJS defaults to 200 for @Post; @HttpCode(201) corrects this to follow
  // the REST convention that a successful creation returns 201.
  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateGroupDto) {
    return this.groupsService.create(dto);
  }

  // PATCH /groups/:id → 200 OK with updated group, or 404 if not found
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupDto) {
    return this.groupsService.update(id, dto);
  }

  // DELETE /groups/:id → 204 No Content (body is empty by convention)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    this.groupsService.remove(id);
    // Returning nothing with @HttpCode(204) means NestJS sends an empty body.
  }
}
