import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  // BIGSERIAL in PostgreSQL — auto-incrementing integer. We use bigint (not
  // uuid) because audit rows are always read sequentially by time range,
  // never by random lookup. Bigint keeps the index tight and insert-fast.
  @PrimaryGeneratedColumn('increment')
  id!: number;

  // The 'sub' claim from the JWT — the user's stable identity across sessions.
  // We store the raw sub string, not a FK to a users table, so audit rows
  // survive even if the user record is deleted (e.g. GDPR erasure of profile
  // data should not erase the audit trail of their actions).
  @Column({ name: 'actor_id', type: 'text' })
  actorId!: string;

  // Namespaced verb: '<resource>.<past_tense_verb>'
  // Examples: 'group.created', 'group.member_promoted', 'auth.rejected'
  // The namespace makes it easy to filter all group events in one query.
  @Column({ type: 'text' })
  action!: string;

  // The kind of resource acted on — 'group', 'review', 'game', etc.
  // Kept as a plain string (not an enum) so new resource types don't require
  // a migration to add an enum value.
  @Column({ name: 'target_type', type: 'text' })
  targetType!: string;

  // The specific resource ID. Combined with targetType this uniquely
  // identifies what was acted on, e.g. targetType='group', targetId='42'.
  @Column({ name: 'target_id', type: 'text' })
  targetId!: string;

  // Optional bag of extra context. Examples:
  //   { oldRole: 'member', newRole: 'admin' }   — for a role change
  //   { ip: '1.2.3.4' }                         — for an auth rejection
  // JSONB (not JSON): PostgreSQL stores JSONB in a binary format that
  // supports indexing and fast field-level queries. JSON stores raw text.
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  // TypeORM's @CreateDateColumn sets this to the DB server's current
  // timestamp on INSERT. We do NOT use JS Date.now() here — clock skew
  // between app containers would make timestamps unreliable for ordering.
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  // There is no @UpdateDateColumn and no deletedAt.
  // This table is append-only by design — see AuditModule for the DB
  // permission constraint that enforces this at the PostgreSQL level.
}
