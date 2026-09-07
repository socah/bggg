import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ChatThreadKind = 'general' | 'proposal' | 'direct';

@Entity('chat_threads')
export class ChatThread {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId!: string | null;

  @Column({ type: 'text' })
  kind!: ChatThreadKind;

  @Column({ name: 'proposal_id', type: 'uuid', nullable: true })
  proposalId!: string | null;

  @Column({ name: 'direct_user_a', type: 'text', nullable: true })
  directUserA!: string | null;

  @Column({ name: 'direct_user_b', type: 'text', nullable: true })
  directUserB!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
