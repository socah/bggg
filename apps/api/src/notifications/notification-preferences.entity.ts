import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('notification_preferences')
export class NotificationPreferences {
  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ name: 'chat_messages', type: 'boolean', default: true })
  chatMessages!: boolean;

  @Column({ name: 'proposal_updates', type: 'boolean', default: true })
  proposalUpdates!: boolean;

  @Column({ name: 'show_message_previews', type: 'boolean', default: false })
  showMessagePreviews!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
