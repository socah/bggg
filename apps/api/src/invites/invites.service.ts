import { randomBytes, createHash } from 'crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  GoneException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Invite, InviteRole } from './invite.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
import { AuditService } from '../audit/audit.service';
import { RegisterInviteDto } from './dto/register-invite.dto';

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export interface InvitePreview {
  groupName: string;
  role: InviteRole;
}

@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    @InjectRepository(Invite)
    private readonly invites: Repository<Invite>,
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
    @InjectRepository(Group)
    private readonly groups: Repository<Group>,
    private readonly keycloakAdmin: KeycloakAdminClient,
    private readonly auditService: AuditService,
  ) {}

  // POST /groups/:id/invites — owner/admin only.
  async createInvite(
    groupId: string,
    role: InviteRole,
    requestingUserId: string,
  ): Promise<{ inviteUrl: string }> {
    await this.assertCanInvite(groupId, requestingUserId);

    const rawToken = randomBytes(32).toString('base64url');

    await this.invites.save(
      this.invites.create({
        tokenHash: this.hashToken(rawToken),
        groupId,
        role,
        createdBy: requestingUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        usedAt: null,
      }),
    );

    await this.auditService.log({
      actorId: requestingUserId,
      action: 'group.invite_created',
      targetType: 'group',
      targetId: groupId,
      metadata: { role },
    });

    // The client turns this into a QR code itself (Decision 3) — the
    // backend's job ends at handing back the plain URL.
    const baseUrl = process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';
    return { inviteUrl: `${baseUrl}/invites/${rawToken}` };
  }

  // GET /invites/:token — public, read-only. Does NOT consume the invite;
  // lets the frontend show "You're invited to X" before anyone commits.
  async previewInvite(rawToken: string): Promise<InvitePreview> {
    const invite = await this.findValidInvite(rawToken);
    const group = await this.groups.findOneBy({ id: invite.groupId });

    if (!group) throw new NotFoundException('Invite not found');

    return { groupName: group.name, role: invite.role };
  }

  // POST /invites/:token/accept — authenticated. Path A: the invitee
  // already has a Keycloak account (AuthGuard already verified their JWT
  // before this method is ever called).
  async acceptInvite(
    rawToken: string,
    acceptingUserId: string,
  ): Promise<{ groupId: string; role: InviteRole }> {
    const invite = await this.findValidInvite(rawToken);
    await this.redeem(invite, acceptingUserId);

    return { groupId: invite.groupId, role: invite.role };
  }

  // POST /invites/:token/register — public, unauthenticated. Path B: the
  // invitee has no account yet. Creates it via the Admin API, then joins,
  // in one operation. See Decision 4 for why AuthGuard can't protect this
  // endpoint the way it protects acceptInvite.
  async registerAndAcceptInvite(
    rawToken: string,
    dto: RegisterInviteDto,
  ): Promise<{ groupId: string; role: InviteRole }> {
    // Re-validate — never trust an earlier previewInvite() call. Time has
    // passed since the frontend last checked; the invite may have expired
    // or been redeemed by someone else in the meantime.
    const invite = await this.findValidInvite(rawToken);

    // class-validator can check each field's own shape but not "at least
    // one of these two", so that rule lives here instead.
    if (!dto.username && !dto.email) {
      throw new BadRequestException('Either a username or an email is required');
    }

    const newUserId = await this.keycloakAdmin.createUser({
      email: dto.email,
      username: dto.username,
      firstName: dto.firstName,
      lastName: dto.lastName,
      password: dto.password,
    });

    try {
      await this.redeem(invite, newUserId);
    } catch (err) {
      // There is no single transaction spanning Keycloak and Postgres — if
      // redeem() fails here, a Keycloak account now exists with no
      // group_members row and no way back in through this invite (it may
      // already be marked used). Best-effort compensating delete, so a
      // retry with the same email doesn't hit "already exists" for an
      // account nobody can use. This cleanup call can itself fail (network,
      // Keycloak down) — logged, not re-thrown, so the caller still sees
      // the original error, not a confusing second one.
      try {
        await this.keycloakAdmin.deleteUser(newUserId);
      } catch (cleanupErr) {
        this.logger.error({
          msg: 'orphaned_keycloak_user_cleanup_failed',
          userId: newUserId,
          err: cleanupErr,
        });
      }
      throw err;
    }

    // Separate from the 'group.member_joined' event redeem() already logs —
    // this one records that a brand-new account was created as part of the
    // same action, which acceptInvite's callers never do.
    await this.auditService.log({
      actorId: newUserId,
      action: 'group.member_registered',
      targetType: 'group',
      targetId: invite.groupId,
      metadata: { role: invite.role },
    });

    return { groupId: invite.groupId, role: invite.role };
  }

  private async findValidInvite(rawToken: string): Promise<Invite> {
    const invite = await this.invites.findOneBy({
      tokenHash: this.hashToken(rawToken),
    });

    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.usedAt) throw new GoneException('Invite already used');
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new GoneException('Invite expired');
    }

    return invite;
  }

  // Shared by both consumption paths. The worked example in
  // notes/3_invite_system.md marks usedAt with a plain find-then-save,
  // which is fine for teaching the ordering lesson (used-before-membership)
  // but leaves a real gap: two concurrent redemptions of the SAME invite
  // could both pass findValidInvite before either writes. This conditional
  // UPDATE closes that gap — it only marks the row used if it is still
  // unused AT THE MOMENT OF THE WRITE, and only the caller whose UPDATE
  // actually changes a row is allowed to proceed to the membership insert.
  private async redeem(invite: Invite, userId: string): Promise<void> {
    const result = await this.invites.update(
      { tokenHash: invite.tokenHash, usedAt: IsNull() },
      { usedAt: new Date(), usedBy: userId },
    );

    if (result.affected === 0) {
      throw new GoneException('Invite already used');
    }

    await this.members.save(
      this.members.create({
        userId,
        groupId: invite.groupId,
        role: invite.role,
      }),
    );

    await this.auditService.log({
      actorId: userId,
      action: 'group.member_joined',
      targetType: 'group',
      targetId: invite.groupId,
      metadata: { role: invite.role },
    });
  }

  private async assertCanInvite(
    groupId: string,
    requestingUserId: string,
  ): Promise<void> {
    const membership = await this.members.findOneBy({
      groupId,
      userId: requestingUserId,
    });

    if (!membership || membership.role === 'member') {
      throw new ForbiddenException(
        'Only group owners and admins can create invites',
      );
    }
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
