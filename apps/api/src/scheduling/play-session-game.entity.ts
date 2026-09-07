import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('play_session_games')
export class PlaySessionGame {
  @PrimaryColumn({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @PrimaryColumn({ name: 'game_id' })
  gameId!: number;

  @Column({ type: 'text', default: 'finished' })
  status!: 'finished' | 'abandoned';
}
