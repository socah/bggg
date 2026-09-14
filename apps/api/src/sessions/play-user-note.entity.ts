import { CreateDateColumn, Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('play_user_notes')
export class PlayUserNote {
  @PrimaryColumn({ name: 'play_id', type: 'uuid' })
  playId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  notes!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
