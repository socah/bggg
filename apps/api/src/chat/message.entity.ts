import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('messages') — one row per chat message, append-only (no update/delete
// endpoints are planned; editing/deleting chat history is out of scope here).
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'thread_id', type: 'uuid' })
  threadId!: string;

  // The JWT 'sub' claim of whoever sent the message — same identity anchor
  // used everywhere else (Group.ownerId, AuditLog.actorId).
  @Column({ name: 'sender_id', type: 'text' })
  senderId!: string;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
