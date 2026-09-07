import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PersonalListType = 'custom' | 'tier';

@Entity('personal_lists')
export class PersonalList {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: PersonalListType;

  @Column({ type: 'jsonb', default: () => `'["S","A","B","C","D"]'::jsonb` })
  tiers!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
