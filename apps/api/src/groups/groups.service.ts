import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Group } from './group.entity';
import { GroupMember } from './group-member.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    // AuditService is injectable here because GroupsModule imports AuditModule,
    // which exports AuditService. No circular dependency — AuditModule never
    // imports GroupsModule.
    private readonly auditService: AuditService,
  ) {}

  // Scoped to groups this user is a MEMBER of (owner, admin, or member role
  // in group_members) — not groups.ownerId. Now that invites can add people
  // to a group (see notes/3_invite_system.md), ownerId alone would hide
  // every group an invited member joined but didn't create.
  async findAll(requestingUserId: string): Promise<Group[]> {
    const memberships = await this.members.findBy({ userId: requestingUserId });
    if (memberships.length === 0) {
      return [await this.provisionSoloGroup(requestingUserId)];
    }

    return this.groupRepository.findBy({
      id: In(memberships.map((m) => m.groupId)),
    });
  }

  async findOne(id: string, requestingUserId: string): Promise<Group> {
    // Step 1: look up by id only — determines whether the row exists at all.
    const group = await this.groupRepository.findOneBy({ id });
    if (!group) throw new NotFoundException(`Group ${id} not found`);

    // Step 2: membership check — determines whether this user may see it.
    // Any role (owner, admin, member) grants read access; mutating actions
    // below additionally require assertCanManage. ForbiddenException → HTTP
    // 403 (authenticated but not authorised), separated from the 404 so
    // AuditService can distinguish a genuine missing resource from an
    // unauthorised access attempt.
    const membership = await this.members.findOneBy({
      groupId: id,
      userId: requestingUserId,
    });
    if (!membership) {
      throw new ForbiddenException('You do not have access to this group');
    }

    return group;
  }

  async create(dto: CreateGroupDto, requestingUserId: string): Promise<Group> {
    const group = this.groupRepository.create({ ...dto, ownerId: requestingUserId });
    const saved = await this.groupRepository.save(group);

    // Group.ownerId records who created the group (a fixed, immutable fact);
    // this group_members row is what actually grants access going forward —
    // findAll/findOne check membership, not ownerId. Without this row, the
    // creator couldn't see the group they just made.
    await this.members.save(
      this.members.create({
        userId: requestingUserId,
        groupId: saved.id,
        role: 'owner',
      }),
    );

    // Audit after save — we need the generated ID for targetId.
    await this.auditService.log({
      actorId: requestingUserId,
      action: 'group.created',
      targetType: 'group',
      targetId: String(saved.id),
      metadata: { name: saved.name },
    });

    return saved;
  }

  async update(id: string, dto: UpdateGroupDto, requestingUserId: string): Promise<Group> {
    // findOne enforces the 404 + "is any kind of member" check; renaming or
    // deleting a group is a step above plain viewing, so it needs its own,
    // stricter check on top.
    const group = await this.findOne(id, requestingUserId);
    await this.assertCanManage(id, requestingUserId);

    Object.assign(group, dto);
    return this.groupRepository.save(group);
  }

  async remove(id: string, requestingUserId: string): Promise<void> {
    const group = await this.findOne(id, requestingUserId);
    await this.assertCanManage(id, requestingUserId);

    await this.groupRepository.remove(group);

    await this.auditService.log({
      actorId: requestingUserId,
      action: 'group.deleted',
      targetType: 'group',
      targetId: id,
      metadata: { name: group.name },
    });
  }

  // Same 'member role can look but not touch' rule InvitesService.
  // assertCanInvite enforces for creating invites — duplicated here rather
  // than shared, since GroupsModule and InvitesModule each independently
  // own their access to GroupMember and neither imports the other (avoiding
  // a circular module dependency for a two-line check).
  private async assertCanManage(groupId: string, requestingUserId: string): Promise<void> {
    const membership = await this.members.findOneBy({
      groupId,
      userId: requestingUserId,
    });

    if (!membership || membership.role === 'member') {
      throw new ForbiddenException('Only group owners and admins can modify this group');
    }
  }

  // Every user always belongs to at least one group. A fixed, unpersonalized
  // name ("Just Me") is used on purpose — nothing in this backend resolves a
  // user's own display name from their JWT, and the UI already labels this
  // group distinctly via isSolo, so there's nothing a personalized name would
  // add. This is a real groups row (not a special-cased in-memory object) so
  // it can anchor solo proposals/sessions later, since group_id is NOT NULL
  // on play_session_proposals.
  private async provisionSoloGroup(userId: string): Promise<Group> {
    const group = this.groupRepository.create({ name: 'Just Me', ownerId: userId, isSolo: true });
    const saved = await this.groupRepository.save(group);

    await this.members.save(
      this.members.create({ userId, groupId: saved.id, role: 'owner' }),
    );

    await this.auditService.log({
      actorId: userId,
      action: 'group.created',
      targetType: 'group',
      targetId: String(saved.id),
      metadata: { name: saved.name, isSolo: true },
    });

    return saved;
  }
}
