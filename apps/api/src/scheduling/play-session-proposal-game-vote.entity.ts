import { Entity, PrimaryColumn } from 'typeorm';

// @Entity('play_session_proposal_game_votes') — one row per (proposed game,
// user) upvote. Deliberately its own table rather than an upvote_count
// column on PlaySessionProposalGame (Decision E): the composite PRIMARY KEY
// below is what makes double-voting impossible at the database level, not
// just inconvenient at the application level. The actual vote count is
// derived with COUNT(*) in SchedulingService — nothing here stores it,
// so there is no counter that can drift out of sync with reality.
//
// No @PrimaryGeneratedColumn — the composite key IS the whole row; a
// surrogate id would just be redundant bookkeeping, same reasoning as
// Invite.tokenHash being a bare @PrimaryColumn rather than an extra id.
@Entity('play_session_proposal_game_votes')
export class PlaySessionProposalGameVote {
  @PrimaryColumn({ name: 'proposal_game_id', type: 'uuid', primaryKeyConstraintName: 'play_session_proposal_game_votes_pkey' })
  proposalGameId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text', primaryKeyConstraintName: 'play_session_proposal_game_votes_pkey' })
  userId!: string;
}
