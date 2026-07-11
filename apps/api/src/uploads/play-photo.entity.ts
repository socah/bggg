import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// @Entity('play_photos') — table name matches db/schema.sql.
@Entity('play_photos')
export class PlayPhoto {
  // uuid PK: this is a public-facing resource (returned to and referenced by
  // the client), so it follows the same convention as Group and Message —
  // see secops.md's "public-facing IDs are UUIDs" checklist item.
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Deliberately a plain uuid column, NOT a TypeORM relation — same
  // bare-column choice as every other cross-table reference in this
  // codebase (Group.ownerId, GroupMember.groupId, ...). PlaySession now
  // exists (topic 3_scheduling) with a uuid PK, so this column's type
  // follows it — see db/schema.sql's comment on play_sessions.id for why
  // it's uuid rather than the originally-sketched SERIAL.
  @Column({ name: 'session_id' })
  sessionId!: string;

  // Stores the JWT `sub` claim of the user who uploaded this photo — same
  // ownership-anchor pattern as Group.ownerId.
  @Column({ name: 'uploaded_by' })
  uploadedBy!: string;

  // The R2 object key (e.g. "play-photos/<userId>/<uuid>") — the source of
  // truth for locating the file in the bucket. Kept even though `url` is
  // also stored, so the public URL can be rebuilt if R2_PUBLIC_URL_BASE
  // ever changes (custom domain migration, etc.) without losing the photo.
  @Column({ unique: true })
  key!: string;

  // Public URL, derived from `key` at confirm time via R2Service.buildPublicUrl
  // and stored so reads never need to reconstruct it.
  @Column()
  url!: string;

  // Read from R2's own HeadObject response at confirm time — NOT trusted
  // from client input, even though the client also declares a contentLength
  // at presign time. Two different jobs: contentLength (presign) constrains
  // what the client is allowed to upload; sizeBytes (here) records what R2
  // actually stored, which is what the storage-quota check in
  // UploadsService sums against. Using the client's number for both would
  // let a buggy client's inflated presign-time claim pollute the real quota
  // total even if the actual uploaded file was smaller (or vice versa).
  @Column({ name: 'size_bytes' })
  sizeBytes!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
