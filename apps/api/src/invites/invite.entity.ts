import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';
import { GroupRole } from '../groups/group-member.entity';

// An invite can only grant 'admin' or 'member' — never 'owner'. Ownership is
// set once, at group creation (see groups.service.ts), not handed out via a
// shareable link.
export type InviteRole = Exclude<GroupRole, 'owner'>;

// @Entity('invites') — one row per outstanding (or spent, or expired) invite.
@Entity('invites')
export class Invite {
  // The SHA-256 hash of the raw token, hex-encoded, IS the primary key —
  // no separate surrogate id. The hash is already unique by construction
  // (256 bits of entropy in the token it was derived from), so a second
  // unique column would just be redundant bookkeeping. See Decision 1 in
  // notes/3_invite_system.md for why it's hashed at all.
  @PrimaryColumn({ name: 'token_hash' })
  tokenHash!: string;

  // Bare uuid column, not a relation — same pattern as GroupMember.groupId
  // and Group.ownerId throughout this codebase.
  @Column({ name: 'group_id' })
  groupId!: string;

  @Column({ type: 'text' })
  role!: InviteRole;

  // The Keycloak 'sub' of whoever created this invite — kept even after the
  // invite is used or expired, so "who invited this person" stays answerable
  // for as long as the row exists. Same identity anchor as everywhere else.
  @Column({ name: 'created_by' })
  createdBy!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  // null = still outstanding. Set exactly once, at the moment the invite is
  // redeemed — see InvitesService.acceptInvite / registerAndAcceptInvite for
  // why that write has to happen before the group_members insert, not after.
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  // The Keycloak 'sub' of whoever redeemed it — set in the same UPDATE as
  // usedAt (see InvitesService.redeem). Kept alongside createdBy so "who
  // invited whom" stays answerable directly from this row, without joining
  // through group_members or the audit log.
  //
  // Explicit 'type' required here (same reason usedAt has one): reflect-
  // metadata can't represent a union type like 'string | null' — it
  // reports a bare 'Object' at runtime, which Postgres's driver rejects
  // outright. createdBy doesn't need this because it's a plain, non-null
  // 'string', which reflects correctly on its own.
  @Column({ name: 'used_by', type: 'text', nullable: true })
  usedBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
