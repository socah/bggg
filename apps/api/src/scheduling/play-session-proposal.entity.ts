import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// Exported so SchedulingService, the controller, and DTOs can all reference
// the same status union instead of each redeclaring it — same pattern as
// GroupRole in group-member.entity.ts.
export type ProposalStatus = 'collecting' | 'confirming' | 'confirmed' | 'cancelled';

// @Entity('play_session_proposals') — the "let's play sometime" step before
// a PlaySession exists. See notes/3_scheduling.md Decision B for the full
// status-machine walkthrough.
@Entity('play_session_proposals')
export class PlaySessionProposal {
  // uuid PK: public-facing (returned to and referenced by the client, e.g.
  // GET /proposals/:id) — same convention as Group and Invite.
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Bare uuid column, not a relation — same choice every other table in
  // this codebase has made for group_id (Group, GroupMember, Invite, ...).
  @Column({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  // Keycloak sub of whoever proposed this — same identity anchor as
  // Group.ownerId, Invite.createdBy.
  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  // The calendar day this proposal is about, chosen by the creator up front
  // (e.g. via a date picker in the UI) — not derived from RSVPs. DATE, not
  // TIMESTAMPTZ, matching GroupMember.joinedAt: only the day matters, not a
  // time of day. Every RSVP's available_start/available_end (Decision G)
  // defaults its time-of-day against THIS date; a member only overrides the
  // date implicitly by picking hours that spill past midnight (the default
  // window itself does exactly that: 10:00 this day through 02:00 the
  // next). Multi-day proposals are out of scope for now — see
  // notes/3_scheduling.md Decision G.
  @Column({ name: 'proposed_date', type: 'date' })
  proposedDate!: string;

  // Legacy compatibility only. New scheduling derives all hosts from the
  // owners of places suggested on the proposal and never writes this column.
  // Explicit 'type' required — 'string | null' reflects as a bare
  // 'Object' at runtime (reflect-metadata can't represent union types),
  // which Postgres's driver rejects (same fix as Invite.usedBy).
  @Column({ name: 'host_id', type: 'text', nullable: true })
  hostId!: string | null;

  // TypeScript narrows this to ProposalStatus; the matching CHECK
  // constraint in db/schema.sql enforces the same four values at the
  // database level, since nothing stops a raw SQL client from bypassing
  // TypeORM entirely.
  @Column({ type: 'text', default: 'collecting' })
  status!: ProposalStatus;

  // Computed once, at the 'collecting' -> 'confirming' transition (Decision
  // D), and stored rather than recomputed live on every read — so the
  // window RSVP holders are locking in against can't silently shift while
  // they're still deciding. Both null until that transition happens.
  @Column({ name: 'confirmed_start', type: 'timestamptz', nullable: true })
  confirmedStart!: Date | null;

  @Column({ name: 'confirmed_end', type: 'timestamptz', nullable: true })
  confirmedEnd!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
