import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('game_saved')
export class GameSaved {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'game_id' })
  gameId!: number;

  @Column({ name: 'added_at', type: 'date', default: () => 'CURRENT_DATE' })
  addedAt!: Date;

  @Column({ type: 'text', default: 'manual' })
  source!: 'manual' | 'bgg';
}
