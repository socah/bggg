import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('play_session_game_results')
export class PlayResult {
  @PrimaryColumn({ name: 'play_id', type: 'uuid' })
  playId!: string;

  @PrimaryColumn({ name: 'session_player_id', type: 'uuid' })
  sessionPlayerId!: string;

  @Column({ name: 'is_winner', type: 'boolean', default: false })
  isWinner!: boolean;

  @Column({ type: 'text', nullable: true })
  score!: string | null;
}
