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

  // Plain uuid column, not a @ManyToOne relation — same choice Group.ownerId
  // and AuditLog.actorId already made in this codebase: querying "all
  // messages for group X" only ever needs the id, and a bare column avoids
  // pulling in TypeORM's relation-loading machinery for a lookup this simple.
  @Column({ name: 'group_id', type: 'text' })
  groupId!: string;

  // The JWT 'sub' claim of whoever sent the message — same identity anchor
  // used everywhere else (Group.ownerId, AuditLog.actorId).
  @Column({ name: 'sender_id', type: 'text' })
  senderId!: string;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
