import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('play_session_players')
export class PlaySessionPlayer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId!: string | null;

  @Column({ name: 'guest_player_id', type: 'uuid', nullable: true })
  guestPlayerId!: string | null;
}
