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
-- last_fetched_at: when this record was last refreshed from BGG.
--   GamesService.findOrFetch/findOrFetchMany compare it against a 7-day TTL
--   to decide whether to re-fetch. Set manually on every BGG fetch, never
--   by an @UpdateDateColumn — see the comment in game.entity.ts for why.
--
-- This table had drifted badly out of sync with games/game.entity.ts — same
-- class of drift already corrected for groups and game_ownership in this
-- file. The columns sketched here (year, image_url, min_playtime,
-- max_playtime, bgg_rating, bgg_weight, last_synced_at) never existed on the
-- entity, and the entity's thumbnail, image, playing_time, year_published,
-- rating, last_fetched_at and created_at were all missing here. Nothing had
-- queried `games` over HTTP before, so it was latent; the BGG collection
-- import (POST /bgg-account/import, GET /bgg-account/games) is the first
-- real consumer and would 500 on every call. Fixed to match the entity
-- exactly. The live dev table held 0 rows, so the correction was applied
-- there with ALTER TABLE — no data migration was involved.
--
-- The old CHECK (min_players > 0) / CHECK (max_players >= min_players)
-- constraints are deliberately NOT carried over: the entity defaults both
-- columns to 0 (BGG omits <minplayers>/<maxplayers> on some entries, and
-- mapItemToGame maps a missing value to 0), which the first check rejects
-- outright and which the second would only survive with an awkward
-- "both zero OR max >= min" rewrite. A bad player-count on one game is not
-- worth 500-ing a whole collection import over, so both are dropped and the
-- values are taken as BGG reports them.
CREATE TABLE IF NOT EXISTS games (
  id              SERIAL       PRIMARY KEY,
  bgg_id          INT          NOT NULL UNIQUE,
  name            TEXT         NOT NULL,
  description     TEXT,                         -- nullable: absent for some BGG entries
  thumbnail       TEXT,                         -- nullable
  image           TEXT,                         -- nullable
  min_players     INT          NOT NULL DEFAULT 0,
  max_players     INT          NOT NULL DEFAULT 0,
  playing_time    INT          NOT NULL DEFAULT 0,
  year_published  INT          NOT NULL DEFAULT 0,
  rating          NUMERIC(4,2) NOT NULL DEFAULT 0,   -- e.g. 7.84
  last_fetched_at TIMESTAMPTZ  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── BGG ACCOUNTS ──────────────────────────────────────────────────────────
-- Backs the 'users.bgg_username' field sketched above — that field was
-- never actually built (this file's 'users' table never became a real
-- TypeORM entity, same as every other table here that originally assumed
-- one). user_id: raw Keycloak sub as TEXT, not an int FK to users(id),
-- matching group_members and everything else in this file.
-- Added for real by the BGG account linking & collection import feature
-- (docs/superpowers/specs/2026-08-20-bgg-account-linking-design.md).
CREATE TABLE IF NOT EXISTS bgg_accounts (
  id            SERIAL       PRIMARY KEY,
  user_id       TEXT         NOT NULL UNIQUE,
  bgg_username  TEXT         NOT NULL,
  linked_at     TIMESTAMPTZ  NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── GAME OWNERSHIP ────────────────────────────────────────────────────────
-- Tracks which users personally own which games. A group's game library is
-- the union of its members' game_ownership rows — there is no separate
-- group_games table. Rows can come from BGG sync or direct app additions.
-- source keeps BGG sync from deleting manually maintained rows.
-- user_id: TEXT, not an INT FK to users(id) as this table originally
-- sketched here — same drift-and-fix already applied to group_members
-- above; this schema's 'users' table was never built as a real entity.
CREATE TABLE IF NOT EXISTS game_ownership (
  id        SERIAL PRIMARY KEY,
  user_id   TEXT   NOT NULL,
  game_id   INT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at  DATE   NOT NULL DEFAULT CURRENT_DATE,
  source    TEXT   NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bgg')),

  UNIQUE (user_id, game_id)
);

-- ── GAME WISHLIST ─────────────────────────────────────────────────────────
-- Personal wishlist, populated either directly or from a linked BGG account.
CREATE TABLE IF NOT EXISTS game_wishlist (
  id        SERIAL PRIMARY KEY,
  user_id   TEXT   NOT NULL,
  game_id   INT    NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at  DATE   NOT NULL DEFAULT CURRENT_DATE,
  source    TEXT   NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bgg')),
  wishlist_priority INT NOT NULL DEFAULT 3 CHECK (wishlist_priority BETWEEN 1 AND 5),

  UNIQUE (user_id, game_id)
);

-- ── SAVED GAMES ────────────────────────────────────────────────────────────
-- App-only bookmarks for games that are neither ownership nor purchase intent.
CREATE TABLE IF NOT EXISTS game_saved (
  id        SERIAL PRIMARY KEY,
  user_id   TEXT NOT NULL,
  game_id   INT  NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  added_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  source    TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bgg')),
  UNIQUE (user_id, game_id)
);

-- ── REVIEWS ───────────────────────────────────────────────────────────────
-- One review per user per game (not scoped to a group — reviews are personal).
-- The design includes complexity and depth scores alongside the main rating.
-- BGG comment-only reviews may omit a rating. Reviews written in the app
-- still require one through API validation.
CREATE TABLE IF NOT EXISTS reviews (
  id               SERIAL       PRIMARY KEY,
  user_id          TEXT         NOT NULL,
  game_id          INT          NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  rating           NUMERIC(4,2) CHECK (rating BETWEEN 1 AND 10),
  complexity_score INT          CHECK (complexity_score BETWEEN 1 AND 5),
  depth_score      INT          CHECK (depth_score BETWEEN 1 AND 5),
  body             TEXT,
  source           TEXT         NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'bgg')),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One review per user per game globally.
  UNIQUE (user_id, game_id)
);

-- ── PERSONAL GAME LISTS ───────────────────────────────────────────────────
-- Custom lists and tier lists can include any cached BGG game, whether or not
-- it also appears in the user's collection or wishlist.
CREATE TABLE IF NOT EXISTS personal_lists (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('custom', 'tier')),
  tiers       JSONB       NOT NULL DEFAULT '["S","A","B","C","D"]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS personal_list_items (
  id        SERIAL PRIMARY KEY,
  list_id   UUID NOT NULL REFERENCES personal_lists(id) ON DELETE CASCADE,
  game_id   INT  NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tier      TEXT,
  position  INT  NOT NULL CHECK (position >= 0),

  UNIQUE (list_id, game_id)
);

-- ── PLAY SESSION PROPOSALS ────────────────────────────────────────────────
-- Future scheduling — the "let's play sometime" step before a play_sessions
-- row exists (Phase 3 — scheduling topic; see notes/3_scheduling.md for the
-- full design discussion).
-- id: UUID — public-facing (returned to and referenced by the client, e.g.
--   GET /proposals/:id), same convention as groups.id and invites.
-- host_id: legacy nullable column retained for compatibility with persisted
--   rows. New scheduling never writes or reads it; hosts are derived from all
--   owners of places suggested on the proposal.
-- status: the confirmation state machine (Decision B).
--   'collecting'  — RSVPs are being gathered, nothing computed yet.
--   'confirming'  — creator requested confirmation; confirmed_start/end
--                   below are now populated, and RSVP holders can lock in.
--   'confirmed'   — creator finalized; a play_sessions row now exists with
--                   this row's id as its proposal_id.
--   'cancelled'   — legacy compatibility only; no API action enters it.
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
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (id, group_id)
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
-- One signed vote per (proposed game, user). The score is derived by summing
-- these rows, while the PRIMARY KEY prevents duplicate votes.
CREATE TABLE IF NOT EXISTS play_session_proposal_game_votes (
  proposal_game_id  UUID  NOT NULL REFERENCES play_session_proposal_games(id) ON DELETE CASCADE,
  user_id           TEXT  NOT NULL,
  value              SMALLINT NOT NULL DEFAULT 1 CHECK (value IN (-1, 1)),

  PRIMARY KEY (proposal_game_id, user_id)
);

-- ── PLACES AND PROPOSAL PLACE POLLS ───────────────────────────────────────
-- Places are reusable across groups. Ownership and durable visibility are
-- independent many-to-many facts keyed by raw Keycloak subjects. A suggested
-- place is scoped to one proposal; votes are derived from their join rows.
CREATE TABLE IF NOT EXISTS places (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  created_by  TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS place_owners (
  place_id  UUID  NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id   TEXT  NOT NULL,
  PRIMARY KEY (place_id, user_id)
);

CREATE TABLE IF NOT EXISTS place_visibility (
  place_id  UUID  NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  user_id   TEXT  NOT NULL,
  hidden    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (place_id, user_id)
);

CREATE TABLE IF NOT EXISTS proposal_places (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID         NOT NULL REFERENCES play_session_proposals(id) ON DELETE CASCADE,
  place_id     UUID         NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  proposed_by  TEXT         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, place_id)
);

CREATE TABLE IF NOT EXISTS proposal_place_votes (
  proposal_place_id  UUID  NOT NULL REFERENCES proposal_places(id) ON DELETE CASCADE,
  user_id             TEXT  NOT NULL,
  value               SMALLINT NOT NULL DEFAULT 1 CHECK (value IN (-1, 1)),
  PRIMARY KEY (proposal_place_id, user_id)
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
  place_id     UUID         REFERENCES places(id) ON DELETE SET NULL,
  proposal_id  UUID         REFERENCES play_session_proposals(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Hosts are snapshotted when a proposal is finalized so later ownership
-- changes do not rewrite hosting history. A session may have multiple hosts.
CREATE TABLE IF NOT EXISTS play_session_hosts (
  session_id  UUID  NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id     TEXT  NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

-- ── PLAY SESSION GAMES ────────────────────────────────────────────────────
-- Each row is one play, so the same game can be logged more than once per session.
-- status: whether the game reached a conclusion.
--   'finished'  — game completed normally; results in play_session_game_results
--   'abandoned' — game started but did not finish (ran out of time, someone left, etc.)
--   When abandoned, play_session_game_results rows may still exist for partial tracking,
--   but is_winner should be false for all players.
-- No winner column here — winners are tracked per-player in play_session_game_results,
-- which supports competitive (one winner), ties (multiple), co-op (all or none), and DNF.
CREATE TABLE IF NOT EXISTS play_session_games (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID  NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  game_id     INT   NOT NULL REFERENCES games(id)         ON DELETE CASCADE,
  status      TEXT  NOT NULL DEFAULT 'finished'
                    CHECK (status IN ('finished', 'abandoned')),
  duration_minutes INT CHECK (duration_minutes > 0 AND duration_minutes <= 10080),
  notes       TEXT,
  logged_by   TEXT  NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_play_session_games_session ON play_session_games(session_id);

-- Reusable group-wide identities for players without platform accounts.
-- Linking rewrites their historical participation to linked_user_id.
CREATE TABLE IF NOT EXISTS guest_players (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (LENGTH(BTRIM(name)) > 0),
  linked_user_id TEXT,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── PLAY SESSION GAME RESULTS ─────────────────────────────────────────────
-- One result row per session participant per play.
-- is_winner: true for competitive winner, all true for co-op win, all false for co-op loss,
--   multiple true for a tie, all false for an abandoned game.
-- The composite FK references the composite PK of play_session_games — this ensures
-- a result row can only exist for a game that is actually listed in the session.
-- ON DELETE CASCADE on users: if a user is deleted, their result rows go with them.
--   The game record and other players' results are unaffected.
-- ── PLAY SESSION PLAYERS ──────────────────────────────────────────────────
-- Tracks which group members attended the session — not all members play every night.
-- notes: per-player personal note ("I had a terrible opening hand but recovered").
--   Separate from the session-level notes, which are shared context for everyone.
CREATE TABLE IF NOT EXISTS play_session_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
  user_id         TEXT,
  guest_player_id UUID REFERENCES guest_players(id) ON DELETE RESTRICT,
  CHECK ((user_id IS NULL) <> (guest_player_id IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_play_session_player_user ON play_session_players(session_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_play_session_player_guest ON play_session_players(session_id, guest_player_id) WHERE guest_player_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS play_session_game_results (
  play_id           UUID    NOT NULL REFERENCES play_session_games(id) ON DELETE CASCADE,
  session_player_id UUID    NOT NULL REFERENCES play_session_players(id) ON DELETE CASCADE,
  is_winner         BOOLEAN NOT NULL DEFAULT false,
  score             TEXT,
  PRIMARY KEY (play_id, session_player_id)
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
  play_id     UUID         REFERENCES play_session_games(id) ON DELETE CASCADE,
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

-- ── CHAT ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_threads (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID        REFERENCES groups(id) ON DELETE CASCADE,
  kind           TEXT        NOT NULL CHECK (kind IN ('general', 'proposal', 'direct')),
  proposal_id    UUID,
  direct_user_a  TEXT,
  direct_user_b  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (kind = 'general' AND group_id IS NOT NULL AND proposal_id IS NULL AND direct_user_a IS NULL AND direct_user_b IS NULL) OR
    (kind = 'proposal' AND group_id IS NOT NULL AND proposal_id IS NOT NULL AND direct_user_a IS NULL AND direct_user_b IS NULL) OR
    (kind = 'direct' AND group_id IS NULL AND proposal_id IS NULL AND direct_user_a IS NOT NULL AND direct_user_b IS NOT NULL AND direct_user_a <= direct_user_b)
  ),
  FOREIGN KEY (proposal_id, group_id) REFERENCES play_session_proposals(id, group_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_general_unique ON chat_threads(group_id) WHERE kind = 'general';
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_proposal_unique ON chat_threads(proposal_id) WHERE kind = 'proposal';
CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_direct_unique ON chat_threads(direct_user_a, direct_user_b) WHERE kind = 'direct';

-- Rollback metadata retained by the global-direct-chat migration. Existing
-- per-group direct threads are merged, so these record every original thread
-- and message mapping if that migration ever needs to be reverted.
CREATE TABLE IF NOT EXISTS global_direct_thread_origins (
  thread_id     UUID,
  group_id      UUID,
  direct_user_a TEXT,
  direct_user_b TEXT,
  created_at    TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS global_direct_message_origins (
  message_id UUID,
  thread_id  UUID
);

CREATE TABLE IF NOT EXISTS messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  UUID        NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  sender_id  TEXT        NOT NULL,
  body       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_thread_dismissals (
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);

-- Hashes of deleted Keycloak subjects. Auth rejects otherwise-valid access
-- tokens for these accounts immediately, without retaining the raw subject.
CREATE TABLE IF NOT EXISTS deleted_account_subjects (
  subject_hash TEXT PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Durable reconciliation across Keycloak deletion and PostgreSQL cleanup.
-- The raw subject is retained only until the final cleanup pass succeeds.
CREATE TABLE IF NOT EXISTS account_deletion_jobs (
  subject_id TEXT PRIMARY KEY,
  tombstone TEXT NOT NULL UNIQUE,
  identity_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_thread_history_idx ON messages(thread_id, created_at DESC, id DESC);

-- Migration-only archive for legacy messages whose unconstrained group_id no
-- longer matched a group when chat threads were introduced. The application
-- never reads this table; retaining it avoids silent historical data loss.
CREATE TABLE IF NOT EXISTS legacy_orphaned_messages (
  id         UUID,
  group_id   TEXT,
  sender_id  TEXT,
  body       TEXT,
  created_at TIMESTAMPTZ
);

-- ── AUDIT LOG ─────────────────────────────────────────────────────────────
-- Append-only record of security-relevant events (Phase 2 — audit_logging topic).
-- actor_id stores the raw Keycloak subject so the audit trail survives user
-- deletion and does not depend on the legacy users table.
-- metadata: JSONB for flexible extra context (e.g. old/new values, IP address).
-- No UPDATE or DELETE should ever touch this table.
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL       PRIMARY KEY,
  actor_id    TEXT         NOT NULL,
  action      TEXT         NOT NULL, -- e.g. 'invite.created', 'review.deleted'
  target_type TEXT         NOT NULL, -- e.g. 'group', 'game', 'invite'
  target_id   TEXT         NOT NULL, -- the id of the affected row
  metadata    JSONB,                 -- flexible extra context
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
