import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'game_id' })
  gameId!: number;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true, transformer: {
    to: (value: number | null) => value,
    from: (value: string | null) => value === null ? null : Number(value),
  } })
  rating!: number | null;

  @Column({ name: 'complexity_score', type: 'integer', nullable: true })
  complexityScore!: number | null;

  @Column({ name: 'depth_score', type: 'integer', nullable: true })
  depthScore!: number | null;

  @Column({ type: 'text', nullable: true })
  body!: string | null;

  @Column({ type: 'text', default: 'manual' })
  source!: 'manual' | 'bgg';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
