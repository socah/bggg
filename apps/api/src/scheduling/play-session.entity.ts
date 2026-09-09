import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('play_sessions') — a game night that actually happened. The row
// itself predates this topic (db/schema.sql has had the table since Phase
// 2/3, for logging past sessions), but this is its first TypeORM entity —
// PlayPhoto.sessionId and play_session_games have both been referencing it
// as a bare int with no class behind it until now.
@Entity('play_sessions')
export class PlaySession {
  // uuid, matching the public-facing-resource convention (Group, Invite,
  // PlaySessionProposal, PlayPhoto). db/schema.sql originally sketched this
  // as SERIAL, from before that convention existed — but there's no data
  // in any environment yet and none of play_session_games,
  // play_session_game_results, or play_session_players have a TypeORM
  // entity built for them yet either (only db/schema.sql's reference DDL),
  // so correcting it now costs a handful of column-type edits, not a real
  // migration. The one already-built dependent, PlayPhoto.sessionId, is
  // updated to match (see uploads/play-photo.entity.ts).
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  @Column({ name: 'played_at', type: 'timestamptz' })
  playedAt!: Date;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'place_id', type: 'uuid', nullable: true })
  placeId!: string | null;

  // uuid, matching PlaySessionProposal.id — nullable because a session can
  // be logged directly (a spontaneous game night) without ever having gone
  // through a proposal. Set exactly once, when SchedulingService finalizes
  // a proposal (Decision B, step 4); cleared along with this whole row if
  // the proposal is later un-confirmed.
  // Explicit 'type' required — 'string | null' reflects as a bare
  // 'Object' at runtime (reflect-metadata can't represent union types),
  // which Postgres's driver rejects (same fix as Invite.usedBy).
  @Column({ name: 'proposal_id', type: 'uuid', nullable: true })
  proposalId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
