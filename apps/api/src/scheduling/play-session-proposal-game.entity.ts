import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';

// @Entity('play_session_proposal_games') — a game suggested for a specific
// proposal. Separate from game_ownership (GamesModule), which tracks a
// user's personal BGG-synced library — this is a lightweight per-proposal
// poll, not a statement of who owns what.
// @Unique: a game can only be proposed once per proposal — further
// interest in an already-proposed game is a vote (see
// play-session-proposal-game-vote.entity.ts), not a second row here.
@Entity('play_session_proposal_games')
@Unique(['proposalId', 'gameId'])
export class PlaySessionProposalGame {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'proposal_id' })
  proposalId!: string;

  // Bare int column, not a relation — same choice game_ownership.gameId
  // already made pointing at the same games table.
  @Column({ name: 'game_id' })
  gameId!: number;

  // Keycloak sub of whoever suggested this game — same identity anchor
  // pattern as everywhere else, not the same thing as "who voted for it."
  @Column({ name: 'proposed_by' })
  proposedBy!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
