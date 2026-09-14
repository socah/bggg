import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('play_session_games')
export class PlaySessionGame {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'game_id' })
  gameId!: number;

  @Column({ type: 'text', default: 'finished' })
  status!: 'finished' | 'abandoned';

  @Column({ name: 'duration_minutes', type: 'int', nullable: true })
  durationMinutes!: number | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'logged_by', type: 'text' })
  loggedBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
