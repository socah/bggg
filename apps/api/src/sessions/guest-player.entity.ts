import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('guest_players')
export class GuestPlayer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'group_id', type: 'uuid' })
  groupId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'linked_user_id', type: 'text', nullable: true })
  linkedUserId!: string | null;

  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
