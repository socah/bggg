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
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  // Stores the JWT `sub` claim of the user who uploaded this photo — same
  // ownership-anchor pattern as Group.ownerId.
  @Column({ name: 'uploaded_by', type: 'text' })
  uploadedBy!: string;

  // The R2 object key (e.g. "play-photos/<userId>/<uuid>") — the ONLY
  // thing persisted to locate the file; there is deliberately no stored
  // `url` column anymore. This bucket is private (see R2Service's own
  // comment on createPresignedGetUrl) — a permanently stored URL would
  // either have to be a public one (defeats the point of a private
  // bucket) or a presigned one (which expires, so storing it would just
  // mean serving a dead link once GET_PRESIGN_EXPIRY_SECONDS passes).
  // Any code that needs to display this photo calls
  // R2Service.createPresignedGetUrl(key) fresh, after checking the
  // requester is actually a member of the group this photo belongs to.
  @Column({ type: 'text', unique: true })
  key!: string;

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
