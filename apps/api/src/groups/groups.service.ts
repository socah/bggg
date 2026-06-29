import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group } from './group.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(
    // @InjectRepository(Group) tells NestJS which entity's repository to inject.
    // The repository is the TypeORM object you call .find(), .save(), .delete() on.
    // It is available because GroupsModule imports TypeOrmModule.forFeature([Group]).
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
  ) {}

  findAll(requestingUserId: string): Promise<Group[]> {
    // Scoped to groups owned by the requester — not the entire table.
    // A user with a valid JWT should only see their own groups.
    // When group membership (member/admin roles) is added in Phase 3,
    // this query will expand to include groups where the user is a member.
    return this.groupRepository.findBy({ ownerId: requestingUserId });
  }

  async findOne(id: string, requestingUserId: string): Promise<Group> {
    // Step 1: look up by id only — determines whether the row exists at all.
    const group = await this.groupRepository.findOneBy({ id });
    if (!group) throw new NotFoundException(`Group ${id} not found`);

    // Step 2: ownership check — determines whether this user may see it.
    // ForbiddenException → HTTP 403 (authenticated but not authorised).
    // Separated from the 404 so AuditService (next topic) can distinguish
    // a genuine missing resource from an unauthorised access attempt.
    if (group.ownerId !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this group');
    }

    return group;
  }

  create(dto: CreateGroupDto, requestingUserId: string): Promise<Group> {
    // .create() builds the entity in memory, merging dto fields.
    // We add ownerId here — it is never accepted from the request body
    // (not in CreateGroupDto) so the user cannot forge ownership.
    const group = this.groupRepository.create({ ...dto, ownerId: requestingUserId });
    return this.groupRepository.save(group);
  }

  async update(id: string, dto: UpdateGroupDto, requestingUserId: string): Promise<Group> {
    // findOne already enforces the 404 + ownership check — if it returns,
    // we know the group exists and belongs to the requester.
    const group = await this.findOne(id, requestingUserId);
    Object.assign(group, dto);
    return this.groupRepository.save(group);
  }

  async remove(id: string, requestingUserId: string): Promise<void> {
    const group = await this.findOne(id, requestingUserId);
    await this.groupRepository.remove(group);
  }
}
