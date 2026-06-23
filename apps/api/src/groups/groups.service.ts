import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from './group.entity';

// DTOs live here for now — they move to their own files once the codebase grows.
// Using classes (not interfaces) so NestJS's ValidationPipe can inspect them
// at runtime in a later topic (2_guards_pipes).
export class CreateGroupDto {
  name: string;
}

export class UpdateGroupDto {
  // Partial: every field optional — a PATCH only sends the fields being changed.
  name?: string;
}

@Injectable()
export class GroupsService {
  constructor(
    // @InjectRepository(Group) tells NestJS which entity's repository to inject.
    // The repository is the TypeORM object you call .find(), .save(), .delete() on.
    // It is available because GroupsModule imports TypeOrmModule.forFeature([Group]).
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
  ) {}

  findAll(): Promise<Group[]> {
    // .find() → SELECT * FROM groups ORDER BY id
    return this.groupRepository.find();
  }

  async findOne(id: number): Promise<Group> {
    // .findOneBy() → SELECT * FROM groups WHERE id = $1
    const group = await this.groupRepository.findOneBy({ id });
    // NotFoundException maps to HTTP 404 — same behaviour as before.
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    return group;
  }

  create(dto: CreateGroupDto): Promise<Group> {
    // .create() builds an entity instance in memory (no DB call yet).
    // .save() then runs INSERT and returns the saved row with id and createdAt filled in.
    const group = this.groupRepository.create(dto);
    return this.groupRepository.save(group);
  }

  async update(id: number, dto: UpdateGroupDto): Promise<Group> {
    const group = await this.findOne(id); // reuses the 404 logic above
    // Object.assign merges dto fields onto the entity instance.
    // .save() detects the existing id and runs UPDATE instead of INSERT.
    Object.assign(group, dto);
    return this.groupRepository.save(group);
  }

  async remove(id: number): Promise<void> {
    const group = await this.findOne(id); // 404 if missing
    // .remove() issues DELETE FROM groups WHERE id = $1.
    // Alternative: .delete({ id }) skips the SELECT but cannot throw 404
    // before attempting the delete — we prefer the explicit check.
    await this.groupRepository.remove(group);
  }
}
