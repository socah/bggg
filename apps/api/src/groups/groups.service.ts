import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Group } from './group.entity';
import { GroupMember, GroupRole } from './group-member.entity';
import { GameOwnership } from '../collections/game-ownership.entity';
import { Game } from '../games/game.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AuditService } from '../audit/audit.service';
import { KeycloakAdminClient, KeycloakUserInfo } from '../keycloak/keycloak-admin.client';
import { CollectionsService } from '../collections/collections.service';

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group)
    private readonly groupRepository: Repository<Group>,
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    // The group game library is the union of members' game_ownership rows —
    // same "each module registers its own repository for a shared entity"
    // pattern SchedulingModule uses for GroupMember.
    @InjectRepository(GameOwnership)
    private readonly ownership: Repository<GameOwnership>,
    @InjectRepository(Game)
    private readonly gamesRepo: Repository<Game>,
    // AuditService is injectable here because GroupsModule imports AuditModule,
    // which exports AuditService. No circular dependency — AuditModule never
    // imports GroupsModule.
    private readonly auditService: AuditService,
    private readonly keycloakAdmin: KeycloakAdminClient,
    private readonly collectionsService: CollectionsService,
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

  // Reuses findOne's existing 404-vs-403 access check — same "look but
  // don't touch" read access every role gets, no stricter check needed
  // since this is read-only. Each member's group_members.role rides along
  // on the response so clients can gate management UI on it without an
  // extra endpoint.
  async getMembers(
    id: string,
    requestingUserId: string,
  ): Promise<Array<Pick<KeycloakUserInfo, 'id' | 'username' | 'displayName'> & { role: string; isCurrentUser: boolean; firstName?: string; bggUsername?: string }>> {
    await this.findOne(id, requestingUserId);

    const memberships = await this.members.findBy({ groupId: id });
    return Promise.all(
      memberships.map(async (m) => {
        const [person, account] = await Promise.all([
          this.keycloakAdmin.getUser(m.userId).catch(() => ({
          username: 'unknown-member',
          displayName: 'Unknown member',
            firstName: '',
          })),
          this.collectionsService.getAccount(m.userId),
        ]);
        return {
          id: m.userId,
          username: person.username,
          displayName: person.displayName,
          ...(person.firstName && { firstName: person.firstName }),
          ...(account?.bggUsername && { bggUsername: account.bggUsername }),
          role: m.role,
          isCurrentUser: m.userId === requestingUserId,
        };
      }),
    );
  }

  async assertMember(groupId: string, userId: string): Promise<GroupMember> {
    const membership = await this.members.findOneBy({ groupId, userId });
    if (!membership) throw new NotFoundException('Group member not found');
    return membership;
  }

  async assertUsersShareGroup(userId: string, otherUserId: string): Promise<void> {
    if (userId === otherUserId) return;
    const memberships = await this.members.findBy({ userId });
    if (memberships.length === 0) {
      throw new ForbiddenException('You can only chat with users from a shared group');
    }
    const sharedMembership = await this.members.findOneBy({
      userId: otherUserId,
      groupId: In(memberships.map((membership) => membership.groupId)),
    });
    if (!sharedMembership) {
      throw new ForbiddenException('You can only chat with users from a shared group');
    }
  }

  async getMemberProfile(id: string, userId: string, requestingUserId: string) {
    await this.findOne(id, requestingUserId);
    const membership = await this.members.findOneBy({ groupId: id, userId });
    if (!membership) throw new NotFoundException('Group member not found');
    const [person, account, library] = await Promise.all([
      this.keycloakAdmin.getUser(userId),
      this.collectionsService.getAccount(userId),
      this.collectionsService.getLibrarySnapshot(userId),
    ]);
    return {
      id: userId,
      username: person.username,
      displayName: person.displayName,
      ...(person.firstName && { firstName: person.firstName }),
      ...(account?.bggUsername && { bggUsername: account.bggUsername }),
      role: membership.role,
      isCurrentUser: userId === requestingUserId,
      ...library,
    };
  }

  // GET /groups/:groupId/games — every game owned by ANY member, deduped,
  // sorted by name. This is the data source for the propose-a-game picker
  // on proposals. Read-only, so plain membership (any role) suffices —
  // same access level as getMembers.
  async getLibrary(
    id: string,
    requestingUserId: string,
  ): Promise<Array<Pick<Game, 'id' | 'bggId' | 'name' | 'image' | 'thumbnail' | 'minPlayers' | 'maxPlayers' | 'playingTime' | 'yearPublished' | 'rating'> & { owners: Array<Pick<KeycloakUserInfo, 'id' | 'username' | 'displayName'>> }>> {
    await this.findOne(id, requestingUserId);

    const memberships = await this.members.findBy({ groupId: id });
    if (memberships.length === 0) return [];

    const ownerships = await this.ownership.findBy({
      userId: In(memberships.map((m) => m.userId)),
    });
    if (ownerships.length === 0) return [];

    // Set-dedupe here, not via DISTINCT SQL — ownership rows per user are
    // already unique on (user_id, game_id), so duplicates only arise ACROSS
    // users, which this collapse handles in one place.
    const gameIds = [...new Set(ownerships.map((o) => o.gameId))];

    const games = await this.gamesRepo.find({
      where: { id: In(gameIds) },
      order: { name: 'ASC' },
    });

    const people = await Promise.all(memberships.map(async (membership) => {
      const person = await this.keycloakAdmin.getUser(membership.userId).catch(() => ({
        id: membership.userId,
        username: 'unknown-member',
        displayName: 'Unknown member',
      }));
      return { id: membership.userId, username: person.username, displayName: person.displayName };
    }));
    const personById = new Map(people.map((person) => [person.id, person]));

    return games.map((g) => ({
      id: g.id,
      bggId: g.bggId,
      name: g.name,
      image: g.image,
      thumbnail: g.thumbnail,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      playingTime: g.playingTime,
      yearPublished: g.yearPublished,
      rating: g.rating,
      owners: ownerships
        .filter((row) => row.gameId === g.id)
        .map((row) => personById.get(row.userId))
        .filter((owner): owner is Pick<KeycloakUserInfo, 'id' | 'username' | 'displayName'> => Boolean(owner)),
    }));
  }

  async create(dto: CreateGroupDto, requestingUserId: string): Promise<Group> {
    return this.persistGroupWithOwner({ ...dto, ownerId: requestingUserId }, {});
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
    await this.assertOwner(id, requestingUserId);

    await this.groupRepository.remove(group);

    await this.auditService.log({
      actorId: requestingUserId,
      action: 'group.deleted',
      targetType: 'group',
      targetId: id,
      metadata: { name: group.name },
    });
  }

  async updateMemberRole(
    groupId: string,
    targetUserId: string,
    role: Exclude<GroupRole, 'owner'>,
    requestingUserId: string,
  ): Promise<GroupMember> {
    const target = await this.assertCanManageMember(groupId, targetUserId, requestingUserId);
    target.role = role;
    const saved = await this.members.save(target);
    await this.auditService.log({
      actorId: requestingUserId,
      action: 'group.member_role_changed',
      targetType: 'group_member',
      targetId: String(target.id),
      metadata: { groupId, userId: targetUserId, newRole: role },
    });
    return saved;
  }

  async removeMember(groupId: string, targetUserId: string, requestingUserId: string): Promise<void> {
    const target = await this.assertCanManageMember(groupId, targetUserId, requestingUserId);
    await this.members.remove(target);
    await this.auditService.log({
      actorId: requestingUserId,
      action: 'group.member_removed',
      targetType: 'group_member',
      targetId: String(target.id),
      metadata: { groupId, userId: targetUserId },
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

  private async assertOwner(groupId: string, requestingUserId: string): Promise<void> {
    const membership = await this.members.findOneBy({ groupId, userId: requestingUserId });
    if (!membership || membership.role !== 'owner') {
      throw new ForbiddenException('Only the group owner can delete this group');
    }
  }

  private async assertCanManageMember(
    groupId: string,
    targetUserId: string,
    requestingUserId: string,
  ): Promise<GroupMember> {
    const requester = await this.members.findOneBy({ groupId, userId: requestingUserId });
    const target = await this.members.findOneBy({ groupId, userId: targetUserId });
    if (!target) throw new NotFoundException('Group member not found');
    if (!requester || target.role === 'owner' || (requester.role === 'admin' && target.role !== 'member')) {
      throw new ForbiddenException('You cannot manage this group member');
    }
    return target;
  }

  // Shared by create() and provisionSoloGroup(): builds a Group row, saves
  // it, gives its creator an 'owner' membership row, and audit-logs
  // 'group.created' — the only two ways a group ever comes into existence.
  private async persistGroupWithOwner(
    attrs: { name: string; ownerId: string; isSolo?: boolean },
    auditMetadata: Record<string, unknown>,
  ): Promise<Group> {
    const group = this.groupRepository.create(attrs);
    const saved = await this.groupRepository.save(group);

    await this.members.save(
      this.members.create({ userId: attrs.ownerId, groupId: saved.id, role: 'owner' }),
    );

    await this.auditService.log({
      actorId: attrs.ownerId,
      action: 'group.created',
      targetType: 'group',
      targetId: String(saved.id),
      metadata: { name: saved.name, ...auditMetadata },
    });

    return saved;
  }

  // Every user always belongs to at least one group. A fixed, unpersonalized
  // name ("Just Me") is used on purpose — nothing in this backend resolves a
  // user's own display name from their JWT, and the UI already labels this
  // group distinctly via isSolo, so there's nothing a personalized name would
  // add. This is a real groups row (not a special-cased in-memory object) so
  // it can anchor solo proposals/sessions later, since group_id is NOT NULL
  // on play_session_proposals.
  private async provisionSoloGroup(userId: string): Promise<Group> {
    try {
      return await this.persistGroupWithOwner(
        { name: 'Just Me', ownerId: userId, isSolo: true },
        { isSolo: true },
      );
    } catch (err) {
      // Unique violation on groups_owner_solo_unique means a concurrent
      // request already provisioned this user's solo group — re-read it
      // instead of erroring, so a race never produces two.
      if (this.isUniqueViolation(err)) {
        const existing = await this.groupRepository.findOneBy({ ownerId: userId, isSolo: true });
        if (existing) return existing;
      }
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
  }
}
