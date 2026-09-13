import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';

// Exported so GroupsService and InvitesService can both reference the same
// set of valid roles instead of each redeclaring the string union.
export type GroupRole = 'owner' | 'admin' | 'member';

// @Entity('group_members') — the join table between users and groups.
// Until this entity existed, Group.ownerId was the ONLY way to associate a
// person with a group. This table is what makes "invite someone else in"
// possible: an invite's whole job (see invite.entity.ts) is to eventually
// produce one row here.
@Entity('group_members')
export class GroupMember {
  @PrimaryGeneratedColumn()
  id!: number;

  // Same identity anchor as Group.ownerId, AuditLog.actorId, and
  // Message.senderId: the raw Keycloak 'sub' claim, stored as text, not a
  // foreign key into a 'users' table. See Decision 2 in
  // notes/3_invite_system.md for why — this codebase has never built a
  // synced users table, even though db/schema.sql sketches one.
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  // Bare uuid column, not a @ManyToOne relation to Group — same choice
  // Message.groupId already made. Every query against this table is "find
  // memberships for group X" or "find groups for user Y"; neither needs
  // TypeORM to eagerly load a full Group object through this row.
  @Column({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  // TypeScript narrows this to GroupRole at compile time. The matching
  // CHECK constraint in db/schema.sql enforces the same three values at the
  // database level, since nothing stops a raw SQL client (or a future bug)
  // from bypassing TypeORM entirely.
  @Column({ type: 'text', default: 'member' })
  role!: GroupRole;

  @Column({ type: 'text', nullable: true })
  nickname?: string | null;

  // DATE, not TIMESTAMPTZ — matches db/schema.sql's joined_at column. We
  // only ever care which day someone joined, never the time of day.
  @Column({ name: 'joined_at', type: 'date', default: () => 'CURRENT_DATE' })
  joinedAt!: Date;
}
