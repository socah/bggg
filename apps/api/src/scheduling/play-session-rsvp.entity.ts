import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

// Exported for the same reason ProposalStatus is exported from
// play-session-proposal.entity.ts — SchedulingService, DTOs, and the
// overlap-window function all need this union without redeclaring it.
export type RsvpStatus = 'yes' | 'maybe' | 'no';

// @Entity('play_session_proposal_rsvps') — one row per (proposal, user).
// @Unique mirrors GroupMember's UNIQUE (user_id, group_id): the database
// itself refuses a second RSVP row for the same person on the same
// proposal — a repeat call has to be an UPDATE, not an INSERT (see
// SchedulingService.rsvp).
@Entity('play_session_proposal_rsvps')
@Unique('play_session_proposal_rsvps_proposal_id_user_id_key', ['proposalId', 'userId'])
export class PlaySessionRsvp {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'proposal_id', type: 'uuid' })
  proposalId!: string;

  // Keycloak sub — same identity anchor as every other userId column here.
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  status!: RsvpStatus;

  // Null when status is 'no' — someone who can't make it has no window to
  // contribute to the overlap computation (Decision D). SchedulingService
  // enforces this pairing (both set together, or both null) rather than
  // the database, matching this codebase's existing "validation lives in
  // the service" pattern (see GroupsService.assertCanManage).
  @Column({ name: 'available_start', type: 'timestamptz', nullable: true })
  availableStart!: Date | null;

  @Column({ name: 'available_end', type: 'timestamptz', nullable: true })
  availableEnd!: Date | null;

  // The per-user lock-in flag from the proposal's 'confirming' stage.
  // Reset to false across every RSVP for a proposal when it's un-confirmed
  // (Decision B, step 5) — never true while the proposal itself is still
  // 'collecting'.
  @Column({ type: 'boolean', default: false })
  confirmed!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // Tracks when a member last changed their answer — e.g. flipping from
  // 'maybe' to 'yes' after seeing who else is in. Nothing reads this yet,
  // but it's cheap to have from day one and expensive to backfill later.
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
