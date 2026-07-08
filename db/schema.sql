-- Board Game Group Platform — Reference Schema
--
-- This file is for learning and reference only. TypeORM generates the real
-- migrations in Phase 2 from decorated entity classes. Keep this in sync
-- manually as the data model evolves.
--
-- Run against the dev database:
--   docker compose -f docker-compose.dev.yml exec db \
--     psql -U bggg -d bggg_dev -f /dev/stdin < db/schema.sql

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
-- id: UUID, not SERIAL — this table was originally written with an integer
--   PK, but group.entity.ts already uses @PrimaryGeneratedColumn('uuid')
--   (groups are a public-facing resource returned directly to clients, e.g.
--   GET /groups/:id — see secops.md's "public-facing IDs are UUIDs" rule).
--   This file had drifted out of sync with the entity; fixed to match.
CREATE TABLE IF NOT EXISTS groups (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── GROUP MEMBERS ─────────────────────────────────────────────────────────
-- Join table: one user can belong to many groups; one group has many users.
-- role: a user can be 'owner', 'admin', or 'member' within a group.
--   CHECK constraint: the database rejects any other value.
--   This is simpler than a separate roles table for a small, fixed set.
CREATE TABLE IF NOT EXISTS group_members (
  id          SERIAL       PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
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

-- ── PLAY SESSIONS ─────────────────────────────────────────────────────────
-- Records a game night / session that actually happened (past tense).
-- Separate from play_session_proposals, which handle future scheduling.
-- A session has no game_id — multiple games can be played in one session,
-- tracked in play_session_games below.
-- proposal_id: nullable — sessions can be logged without a prior proposal.
--   FK constraint added later via ALTER TABLE once play_session_proposals exists.
CREATE TABLE IF NOT EXISTS play_sessions (
  id           SERIAL       PRIMARY KEY,
  group_id     UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  played_at    TIMESTAMPTZ  NOT NULL,
  notes        TEXT,                   -- session-level notes (e.g. "hosted at Alice's")
  proposal_id  INT,                    -- FK to play_session_proposals, added later
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
  session_id  INT   NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
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
  session_id  INT     NOT NULL,
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
  session_id  INT  NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id     INT  NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  notes       TEXT,

  PRIMARY KEY (session_id, user_id)
);

-- ── PLAY PHOTOS ───────────────────────────────────────────────────────────
-- User-uploaded photos for a play session (Phase 3 — r2_uploads topic).
-- Binaries live in Cloudflare R2; this table only stores the object key and
-- the derived public URL. Uploaded via a presigned URL the client PUTs
-- directly to R2 — NestJS never receives the file bytes.
-- session_id: no FK constraint yet — play_sessions has no TypeORM entity
--   until topic 3_scheduling. Added via ALTER TABLE once that lands, same
--   deferred-FK pattern already used for play_sessions.proposal_id above.
-- key: UNIQUE — the R2 object key, one row per uploaded object.
-- uploaded_by: the Keycloak JWT `sub` claim, not an int FK to users(id) —
--   same "plain column holding the JWT subject, no relation" pattern as
--   Group.ownerId and Message.senderId elsewhere in this schema.
-- size_bytes: read from R2's HeadObject response at confirm time, not from
--   client input — this is what the storage-quota check in
--   UploadsService.presign sums across all rows before issuing a new
--   presigned URL, to stay under the R2 free tier allowance.
CREATE TABLE IF NOT EXISTS play_photos (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  INT          NOT NULL, -- FK to play_sessions, added later
  uploaded_by TEXT         NOT NULL,
  key         TEXT         NOT NULL UNIQUE,
  url         TEXT         NOT NULL,
  size_bytes  INT          NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── INVITES ───────────────────────────────────────────────────────────────
-- Signed invite tokens for joining a group (Phase 3 — invite_system topic).
-- token: a random URL-safe string; UNIQUE so it can be looked up directly.
-- used_at / used_by: NULL until the invite is redeemed. Single-use.
CREATE TABLE IF NOT EXISTS invites (
  id          SERIAL       PRIMARY KEY,
  group_id    UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by  INT          NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  token       TEXT         NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ  NOT NULL,
  used_at     TIMESTAMPTZ,           -- NULL = not yet used
  used_by     INT          REFERENCES users(id) ON DELETE SET NULL
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
