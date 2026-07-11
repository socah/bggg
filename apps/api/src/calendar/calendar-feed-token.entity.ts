import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

// @Entity('calendar_feed_tokens') — one row per user, backing their personal
// iCal subscription URL (notes/3_scheduling.md Decision C). Same
// hash-at-rest shape as Invite: the raw token is generated with
// randomBytes, shown to the user exactly once, and only its SHA-256 hash is
// ever stored — see CalendarService.issueFeedToken.
//
// Unlike Invite, there is no usedAt/usedBy here: a calendar app resupplies
// this same token on every scheduled refresh, so "single-use" doesn't
// apply. The only revocation path is regenerating the token, which
// overwrites this row (userId is UNIQUE — at most one live token per user).
@Entity('calendar_feed_tokens')
export class CalendarFeedToken {
  // Hash IS the primary key, not a separate surrogate id — same reasoning
  // as Invite.tokenHash: it's already unique by construction (derived from
  // 256 bits of random entropy), so a second unique column would be
  // redundant bookkeeping.
  @PrimaryColumn({ name: 'token_hash' })
  tokenHash!: string;

  // UNIQUE, not just indexed: enforces "at most one active feed token per
  // user" at the database level, not merely by service-layer convention —
  // issuing a new one has to overwrite the old row, not add a second one.
  @Column({ name: 'user_id', unique: true })
  userId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
