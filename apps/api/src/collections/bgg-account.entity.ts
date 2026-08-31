import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// @Entity('bgg_accounts') — one row per person who has linked a BGG
// username. userId is the raw Keycloak 'sub', stored as text, matching
// GroupMember.userId, AuditLog.actorId, and every other identity column in
// this codebase — there is no synced 'users' table to have a real FK into.
@Entity('bgg_accounts')
export class BggAccount {
  @PrimaryGeneratedColumn()
  id!: number;

  // unique: true — one BGG link per person. Re-linking updates this row
  // rather than creating a second one.
  @Column({ name: 'user_id', type: 'text', unique: true })
  userId!: string;

  @Column({ name: 'bgg_username', type: 'text' })
  bggUsername!: string;

  // Set explicitly by CollectionsService.linkAccount on every link/re-link,
  // not @CreateDateColumn — a re-link (changing bggUsername) should update
  // this timestamp, and @CreateDateColumn only ever fires once, at INSERT.
  @Column({ name: 'linked_at', type: 'timestamptz' })
  linkedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
