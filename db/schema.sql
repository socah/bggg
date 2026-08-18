-- Board Game Group Platform — Reference Schema
--
-- This file is human-readable reference documentation only — it is never
-- applied directly anymore. The real, applied schema lives in
-- apps/api/src/migrations/ (run via 'make migrate' in dev, and
-- automatically as part of every prod deploy — see
-- infra/ansible/roles/app_deploy/tasks/main.yml). Keep this file in sync
-- by hand as the data model evolves, the same way it always has been; a
-- change here with no matching migration is exactly the drift that broke
-- production once already (see the is_solo history below, and
-- docs/superpowers/specs/2026-08-18-typeorm-migrations-design.md).

-- ── USERS ─────────────────────────────────────────────────────────────────
-- We do not store passwords. Authentication is handled by Keycloak.
-- keycloak_sub is the "subject" claim from the JWT — a stable UUID that
-- Keycloak assigns each user and never changes, even if the email does.
-- This is the only identifier we trust from the token.
-- bgg_username: nullable — only set if the user links their BGG account.
-- Used by the background BGG collection sync job (Phase 2).
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL       PRIMARY KEY,
  keycloak_sub   TEXT         NOT NULL UNIQUE, -- e.g. "a3f2c1d0-..."
  display_name   TEXT         NOT NULL,
  avatar_url     TEXT,                         -- nullable: not all users set one
  bgg_username   TEXT,                         -- nullable: linked BGG account
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── GROUPS ────────────────────────────────────────────────────────────────
-- A group is the central organising unit: members, games, and sessions all
-- belong to a group.
-- Decision: 'groups' not 'group' — GROUP is a reserved word in SQL.
--
-- is_solo/groups_owner_solo_unique were added after some databases already
-- had a `groups` table without them — for a while this file only
-- documented the two statements needed to catch such a database up
-- (a manual, easy-to-forget step; production ran without them for a
-- while, and every GET /groups 500'd as a result). That reconciliation is
-- now real, executable SQL in apps/api/src/migrations/'s baseline
-- migration instead of a comment here — see this file's own header.
--
-- id: UUID, not SERIAL — this table was originally written with an integer
--   PK, but group.entity.ts already uses @PrimaryGeneratedColumn('uuid')
--   (groups are a public-facing resource returned directly to clients, e.g.
--   GET /groups/:id — see secops.md's "public-facing IDs are UUIDs" rule).
--   This file had drifted out of sync with the entity; fixed to match.
-- owner_id: this file previously omitted it entirely, even though
--   group.entity.ts has always had it — another drift, fixed here. Raw
--   Keycloak sub (TEXT), not an int FK to users(id); see group_members below
--   for why this table never actually adopted the users(id) FK pattern.
-- is_solo: true for the one group every user is auto-provisioned on first
--   GroupsService.findAll() call with zero memberships (see groups.service.ts)
--   — lets the group switcher label it distinctly.
CREATE TABLE IF NOT EXISTS groups (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  owner_id    TEXT         NOT NULL,
  is_solo     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Enforces "at most one solo group per user" at the database level — the last
-- line of defense against the race provisionSoloGroup() otherwise guards
-- against in application code.
CREATE UNIQUE INDEX IF NOT EXISTS groups_owner_solo_unique ON groups(owner_id) WHERE is_solo;

-- ── GROUP MEMBERS ─────────────────────────────────────────────────────────
-- Join table: one user can belong to many groups; one group has many users.
-- Added for real in Phase 3 — invite_system topic (see notes/3_invite_system.md).
-- role: a user can be 'owner', 'admin', or 'member' within a group.
--   CHECK constraint: the database rejects any other value.
--   This is simpler than a separate roles table for a small, fixed set.
-- user_id: TEXT, not an int FK to users(id) as originally sketched here —
--   this schema's own 'users' table was never actually built as a TypeORM
--   entity. Group.ownerId, AuditLog.actorId, Message.senderId, and
--   PlayPhoto.uploadedBy all independently settled on "raw Keycloak sub as
--   text, no relation" instead; group_members.user_id follows the same
--   established pattern rather than being the first table to introduce a
--   users(id) FK that nothing else in the running application uses.
CREATE TABLE IF NOT EXISTS group_members (
  id          SERIAL       PRIMARY KEY,
  user_id     TEXT         NOT NULL,
  group_id    UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role        TEXT         NOT NULL DEFAULT 'member'
                           CHECK (role IN ('owner', 'admin', 'member')),
  joined_at   DATE         NOT NULL DEFAULT CURRENT_DATE,

  -- Prevents the same user from being added to the same group twice.
  UNIQUE (user_id, group_id)
);

-- ── GAMES ─────────────────────────────────────────────────────────────────
-- Shared game catalogue, keyed by BGG ID. One record per game regardless of
-- how many users own it — ownership is tracked separately in game_ownership.
-- last_synced_at: when this record was last refreshed from BGG. The background
-- sync job uses this to decide whether to re-fetch stale data.
CREATE TABLE IF NOT EXISTS games (
  id             SERIAL       PRIMARY KEY,
  bgg_id         INT          NOT NULL UNIQUE,
  name           TEXT         NOT NULL,
  year           INT,
  image_url      TEXT,
  min_players    INT          CHECK (min_players > 0),
  max_players    INT          CHECK (max_players >= min_players),
  min_playtime   INT,
  max_playtime   INT,
  bgg_rating     NUMERIC(4,2),                -- e.g. 7.84
  bgg_weight     NUMERIC(3,2),                -- complexity 1.0–5.0
  description    TEXT,
  last_synced_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── GAME OWNERSHIP ────────────────────────────────────────────────────────
-- Tracks which users personally own which games.
-- A group's game library is the union of its members' game_ownership rows —
-- there is no separate group_games table. This matches how BGG sync works:
-- the user syncs their personal BGG collection, creating ownership rows for
-- each game they own. The group sees games owned by its members.
CREATE TABLE IF NOT EXISTS game_ownership (
  user_id   INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id   INT  NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at  DATE NOT NULL DEFAULT CURRENT_DATE,

  PRIMARY KEY (user_id, game_id)
);

-- ── REVIEWS ───────────────────────────────────────────────────────────────
-- One review per user per game (not scoped to a group — reviews are personal).
-- The design includes complexity and depth scores alongside the main rating.
-- All three are optional individually but at least rating must be present.
CREATE TABLE IF NOT EXISTS reviews (
  id               SERIAL       PRIMARY KEY,
  user_id          INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id          INT          NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  rating           INT          NOT NULL CHECK (rating BETWEEN 1 AND 10),
  complexity_score INT          CHECK (complexity_score BETWEEN 1 AND 5),
  depth_score      INT          CHECK (depth_score BETWEEN 1 AND 5),
  body             TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One review per user per game globally.
  UNIQUE (user_id, game_id)
);

-- ── PLAY SESSION PROPOSALS ────────────────────────────────────────────────
-- Future scheduling — the "let's play sometime" step before a play_sessions
-- row exists (Phase 3 — scheduling topic; see notes/3_scheduling.md for the
-- full design discussion).
-- id: UUID — public-facing (returned to and referenced by the client, e.g.
--   GET /proposals/:id), same convention as groups.id and invites.
-- host_id: nullable Keycloak sub of the RSVP holder hosting the session
--   (e.g. "at my place"). Not a FK to group_members — same "plain column,
--   no relation" pattern as everywhere else in this file. When set, the
--   overlap-window computation in SchedulingService anchors to the host's
--   own availability window rather than any pair of members (Decision D in
--   notes/3_scheduling.md).
-- status: the confirmation state machine (Decision B).
--   'collecting'  — RSVPs are being gathered, nothing computed yet.
--   'confirming'  — creator requested confirmation; confirmed_start/end
--                   below are now populated, and RSVP holders can lock in.
--   'confirmed'   — creator finalized; a play_sessions row now exists with
--                   this row's id as its proposal_id.
--   'cancelled'   — proposal abandoned; no play_sessions row will follow.
-- confirmed_start / confirmed_end: the trimmed overlap window (Decision D),
--   computed once at the 'collecting' -> 'confirming' transition and stored
--   rather than recomputed on every read, so it can't silently shift while
--   people are still deciding whether to lock in. NULL until 'confirming'.
CREATE TABLE IF NOT EXISTS play_session_proposals (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by       TEXT         NOT NULL,
  proposed_date    DATE         NOT NULL, -- the calendar day this proposal is about; RSVP windows default their time-of-day against this
  host_id          TEXT,
  status           TEXT         NOT NULL DEFAULT 'collecting'
                               CHECK (status IN ('collecting', 'confirming', 'confirmed', 'cancelled')),
  confirmed_start  TIMESTAMPTZ,
  confirmed_end    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── PLAY SESSION PROPOSAL RSVPS ───────────────────────────────────────────
-- One row per (proposal, user) — a member's answer to a specific proposal.
-- UNIQUE (proposal_id, user_id): the same "one answer per person, ever"
-- constraint group_members already enforces for group membership — a
-- second RSVP from the same user updates this row, never inserts a new one.
-- available_start / available_end: nullable — NULL when status = 'no'
--   (someone who can't make it has no window to contribute). These are the
--   per-user inputs the overlap-window computation (Decision D) consumes.
-- confirmed: the per-user lock-in flag from the 'confirming' stage. Reset to
--   false for every row when a proposal is un-confirmed (Decision B, step 5).
CREATE TABLE IF NOT EXISTS play_session_proposal_rsvps (
  id               SERIAL       PRIMARY KEY,
  proposal_id      UUID         NOT NULL REFERENCES play_session_proposals(id) ON DELETE CASCADE,
  user_id          TEXT         NOT NULL,
  status           TEXT         NOT NULL CHECK (status IN ('yes', 'maybe', 'no')),
  available_start  TIMESTAMPTZ,
  available_end    TIMESTAMPTZ,
  confirmed        BOOLEAN      NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (proposal_id, user_id)
);

-- ── PLAY SESSION PROPOSAL GAMES ───────────────────────────────────────────
-- Games suggested for a specific proposal — a lightweight poll, separate
-- from game_ownership (which tracks a user's personal BGG-synced library).
-- UNIQUE (proposal_id, game_id): a game can only be proposed once per
-- proposal; further interest in it is expressed as a vote (below), not a
-- second proposal row.
CREATE TABLE IF NOT EXISTS play_session_proposal_games (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID         NOT NULL REFERENCES play_session_proposals(id) ON DELETE CASCADE,
  game_id      INT          NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  proposed_by  TEXT         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  UNIQUE (proposal_id, game_id)
);

-- ── PLAY SESSION PROPOSAL GAME VOTES ──────────────────────────────────────
-- One row per (proposed game, user) upvote. Deliberately a separate table
-- rather than an upvote_count column on play_session_proposal_games
-- (Decision E) — the PRIMARY KEY is what prevents the same user upvoting
-- the same game twice; the count itself is derived with COUNT(*), never
-- stored, so there is nothing to keep in sync.
CREATE TABLE IF NOT EXISTS play_session_proposal_game_votes (
  proposal_game_id  UUID  NOT NULL REFERENCES play_session_proposal_games(id) ON DELETE CASCADE,
  user_id           TEXT  NOT NULL,

  PRIMARY KEY (proposal_game_id, user_id)
);

-- ── CALENDAR FEED TOKENS ──────────────────────────────────────────────────
-- One opaque, long-lived token per user, backing the personal iCal
-- subscription feed (Phase 3 — scheduling topic; Decision C in
-- notes/3_scheduling.md). Same hash-at-rest shape as invites — the raw
-- token is shown once and never stored — but NOT single-use: a calendar
-- app re-supplies the same token on every refresh, so there is no used_at.
-- user_id UNIQUE: at most one active feed token per user. Regenerating
-- replaces the row (old token_hash stops matching anything), which is the
-- only revocation path — there's no per-token expiry to fall back on.
CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
  token_hash  TEXT         PRIMARY KEY,
  user_id     TEXT         NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── PLAY SESSIONS ─────────────────────────────────────────────────────────
-- Records a game night / session that actually happened (past tense).
-- Separate from play_session_proposals above, which handle future scheduling.
-- A session has no game_id — multiple games can be played in one session,
-- tracked in play_session_games below.
-- id: UUID, not SERIAL — this file originally sketched it as SERIAL, before
--   the "public-facing resources get a uuid PK" convention (Group, Invite,
--   PlaySessionProposal, PlayPhoto) was established. Corrected here rather
--   than left inconsistent: no environment has real data yet, and none of
--   play_session_games/play_session_game_results/play_session_players had a
--   TypeORM entity built against the old INT type — only this reference
--   file — so there is no actual migration cost, just column-type edits.
--   The one dependent that DID already have a TypeORM entity,
--   play_photos.session_id, is updated to match below.
-- proposal_id: nullable — sessions can be logged without a prior proposal
--   (someone just types up a session that happened spontaneously). Set
--   exactly once, when a proposal is finalized into a session (Decision B,
--   step 4); cleared along with the row itself if the proposal is later
--   un-confirmed.
CREATE TABLE IF NOT EXISTS play_sessions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  played_at    TIMESTAMPTZ  NOT NULL,
  notes        TEXT,                   -- session-level notes (e.g. "hosted at Alice's")
  proposal_id  UUID         REFERENCES play_session_proposals(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── PLAY SESSION GAMES ────────────────────────────────────────────────────
-- Which games were played during a session. Multiple games per session allowed.
-- status: whether the game reached a conclusion.
--   'finished'  — game completed normally; results in play_session_game_results
--   'abandoned' — game started but did not finish (ran out of time, someone left, etc.)
--   When abandoned, play_session_game_results rows may still exist for partial tracking,
--   but is_winner should be false for all players.
-- No winner column here — winners are tracked per-player in play_session_game_results,
-- which supports competitive (one winner), ties (multiple), co-op (all or none), and DNF.
CREATE TABLE IF NOT EXISTS play_session_games (
  session_id  UUID  NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  game_id     INT   NOT NULL REFERENCES games(id)         ON DELETE CASCADE,
  status      TEXT  NOT NULL DEFAULT 'finished'
                    CHECK (status IN ('finished', 'abandoned')),

  PRIMARY KEY (session_id, game_id)
);

-- ── PLAY SESSION GAME RESULTS ─────────────────────────────────────────────
-- One row per player per game within a session.
-- is_winner: true for competitive winner, all true for co-op win, all false for co-op loss,
--   multiple true for a tie, all false for an abandoned game.
-- The composite FK references the composite PK of play_session_games — this ensures
-- a result row can only exist for a game that is actually listed in the session.
-- ON DELETE CASCADE on users: if a user is deleted, their result rows go with them.
--   The game record and other players' results are unaffected.
CREATE TABLE IF NOT EXISTS play_session_game_results (
  session_id  UUID    NOT NULL,
  game_id     INT     NOT NULL,
  user_id     INT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_winner   BOOLEAN NOT NULL DEFAULT false,

  PRIMARY KEY (session_id, game_id, user_id),
  FOREIGN KEY (session_id, game_id)
    REFERENCES play_session_games(session_id, game_id) ON DELETE CASCADE
);

-- ── PLAY SESSION PLAYERS ──────────────────────────────────────────────────
-- Tracks which group members attended the session — not all members play every night.
-- notes: per-player personal note ("I had a terrible opening hand but recovered").
--   Separate from the session-level notes, which are shared context for everyone.
CREATE TABLE IF NOT EXISTS play_session_players (
  session_id  UUID  NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id     INT   NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  notes       TEXT,

  PRIMARY KEY (session_id, user_id)
);

-- ── PLAY PHOTOS ───────────────────────────────────────────────────────────
-- User-uploaded photos for a play session (Phase 3 — r2_uploads topic).
-- Binaries live in Cloudflare R2; this table only stores the object key and
-- the derived public URL. Uploaded via a presigned URL the client PUTs
-- directly to R2 — NestJS never receives the file bytes.
-- session_id: FK resolved now that play_sessions has a TypeORM entity
--   (topic 3_scheduling) — this column originally had no constraint since
--   play_sessions didn't exist as an entity yet. UUID, matching
--   play_sessions.id's corrected type — see the comment on that table.
-- key: UNIQUE — the R2 object key, one row per uploaded object. No `url`
--   column: this bucket is private (photos are only meant to be visible to
--   a session's group, not to anyone with a link), so there is no
--   permanent URL to store — R2Service.createPresignedGetUrl(key) signs a
--   short-lived one on demand, after checking the requester is actually
--   authorized to see this specific photo. A stored URL would either have
--   to be a public one (defeats the point of a private bucket) or a
--   presigned one (which expires — storing it would just mean serving a
--   dead link once it does). See notes/3_r2_uploads.md's Update section.
-- uploaded_by: the Keycloak JWT `sub` claim, not an int FK to users(id) —
--   same "plain column holding the JWT subject, no relation" pattern as
--   Group.ownerId and Message.senderId elsewhere in this schema.
-- size_bytes: read from R2's HeadObject response at confirm time, not from
--   client input — this is what the storage-quota check in
--   UploadsService.presign sums across all rows before issuing a new
--   presigned URL, to stay under the R2 free tier allowance.
CREATE TABLE IF NOT EXISTS play_photos (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID         NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  uploaded_by TEXT         NOT NULL,
  key         TEXT         NOT NULL UNIQUE,
  size_bytes  INT          NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── INVITES ───────────────────────────────────────────────────────────────
-- Single-use invite tokens for joining a group (Phase 3 — invite_system
-- topic; see notes/3_invite_system.md for the full design discussion).
-- token_hash IS the primary key, not a separate SERIAL id — the raw token
--   is 256 bits of random entropy hashed with SHA-256 before it ever reaches
--   this table (Decision 1: opaque hashed token, not a self-contained signed
--   JWT — single-use/revocation needs a DB row either way, so the token
--   itself only needs to be unguessable, not self-describing). The plaintext
--   token is shown to the inviter exactly once and never stored anywhere.
-- role: deliberately excludes 'owner' — an invite can only grant 'admin' or
--   'member'; ownership is set once, at group creation, not handed out via
--   a shareable link. See InviteRole in invite.entity.ts.
-- created_by / used_by: TEXT (raw Keycloak sub), same reasoning as
--   group_members.user_id above — no users(id) FK, since nothing in this
--   application actually populates a users table.
-- used_at / used_by: NULL until redeemed. Both set atomically in the same
--   UPDATE, guarded by `WHERE used_at IS NULL`, so two concurrent redemption
--   attempts for the same invite can't both succeed — see the "atomic
--   conditional UPDATE" discussion in notes/3_invite_system.md.
CREATE TABLE IF NOT EXISTS invites (
  token_hash  TEXT         PRIMARY KEY,
  group_id    UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role        TEXT         NOT NULL CHECK (role IN ('admin', 'member')),
  created_by  TEXT         NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,           -- NULL = not yet used
  used_by     TEXT,                  -- NULL until redeemed
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOG ─────────────────────────────────────────────────────────────
-- Append-only record of security-relevant events (Phase 2 — audit_logging topic).
-- user_id ON DELETE SET NULL: preserve the log even if the user is deleted.
-- metadata: JSONB for flexible extra context (e.g. old/new values, IP address).
-- No UPDATE or DELETE should ever touch this table.
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL       PRIMARY KEY,
  user_id      INT          REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT         NOT NULL, -- e.g. 'invite.created', 'review.deleted'
  target_type  TEXT,                  -- e.g. 'group', 'game', 'invite'
  target_id    INT,                   -- the id of the affected row
  metadata     JSONB,                 -- flexible extra context
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
