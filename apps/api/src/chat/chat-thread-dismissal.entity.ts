import { Entity, PrimaryColumn } from 'typeorm';

@Entity('chat_thread_dismissals')
export class ChatThreadDismissal {
  @PrimaryColumn({ name: 'thread_id', type: 'uuid', primaryKeyConstraintName: 'chat_thread_dismissals_pkey' })
  threadId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text', primaryKeyConstraintName: 'chat_thread_dismissals_pkey' })
  userId!: string;
}
