import type { MigrationInterface, QueryRunner } from 'typeorm';

// This is the first real migration adopted into a project that had none —
// every statement here is written the same idempotent way db/schema.sql
// already was ('IF NOT EXISTS' throughout), so running it is safe no
// matter which of three states the target database is in:
//   1. Brand new (fresh dev container): every statement below creates it.
//   2. Already fully caught up (schema.sql was applied by hand up to and
//      including the is_solo column/index): every statement is a no-op.
//   3. Partially caught up — this is today's actual production state:
//      tables already exist from an earlier hand-applied schema.sql, but
//      'is_solo' and its unique index were only ever documented as a
//      manual step, never actually run. The two ALTER/CREATE INDEX
//      statements below are what that step's real SQL should have been —
//      they run for real here, closing that exact gap.
//
// Kept as one flat statement list (not per-table helper methods) because
// that's the most direct mapping back to db/schema.sql, which is what a
// reviewer will actually compare this against.
export class Baseline1787081098000 implements MigrationInterface {
  name = 'Baseline1787081098000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id             SERIAL       PRIMARY KEY,
        keycloak_sub   TEXT         NOT NULL UNIQUE,
        display_name   TEXT         NOT NULL,
        avatar_url     TEXT,
        bgg_username   TEXT,
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT         NOT NULL,
        owner_id    TEXT         NOT NULL,
        is_solo     BOOLEAN      NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    // The statement above only creates 'is_solo' on a table that doesn't
    // exist yet. This is what actually fixes a database (like prod's) that
    // already had a 'groups' table before this column was added — see
    // this migration's own header.
    await queryRunner.query(
      `ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_solo BOOLEAN NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS groups_owner_solo_unique ON groups(owner_id) WHERE is_solo`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        id          SERIAL       PRIMARY KEY,
        user_id     TEXT         NOT NULL,
        group_id    UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        role        TEXT         NOT NULL DEFAULT 'member'
                                 CHECK (role IN ('owner', 'admin', 'member')),
        joined_at   DATE         NOT NULL DEFAULT CURRENT_DATE,

        UNIQUE (user_id, group_id)
      )
    `);

    await queryRunner.query(`
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
        bgg_rating     NUMERIC(4,2),
        bgg_weight     NUMERIC(3,2),
        description    TEXT,
        last_synced_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS game_ownership (
        user_id   INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id   INT  NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        added_at  DATE NOT NULL DEFAULT CURRENT_DATE,

        PRIMARY KEY (user_id, game_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id               SERIAL       PRIMARY KEY,
        user_id          INT          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id          INT          NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        rating           INT          NOT NULL CHECK (rating BETWEEN 1 AND 10),
        complexity_score INT          CHECK (complexity_score BETWEEN 1 AND 5),
        depth_score      INT          CHECK (depth_score BETWEEN 1 AND 5),
        body             TEXT,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        UNIQUE (user_id, game_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_session_proposals (
        id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id         UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        created_by       TEXT         NOT NULL,
        proposed_date    DATE         NOT NULL,
        host_id          TEXT,
        status           TEXT         NOT NULL DEFAULT 'collecting'
                                     CHECK (status IN ('collecting', 'confirming', 'confirmed', 'cancelled')),
        confirmed_start  TIMESTAMPTZ,
        confirmed_end    TIMESTAMPTZ,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
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
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_session_proposal_games (
        id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_id  UUID         NOT NULL REFERENCES play_session_proposals(id) ON DELETE CASCADE,
        game_id      INT          NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        proposed_by  TEXT         NOT NULL,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

        UNIQUE (proposal_id, game_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_session_proposal_game_votes (
        proposal_game_id  UUID  NOT NULL REFERENCES play_session_proposal_games(id) ON DELETE CASCADE,
        user_id           TEXT  NOT NULL,

        PRIMARY KEY (proposal_game_id, user_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS calendar_feed_tokens (
        token_hash  TEXT         PRIMARY KEY,
        user_id     TEXT         NOT NULL UNIQUE,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_sessions (
        id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id     UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        played_at    TIMESTAMPTZ  NOT NULL,
        notes        TEXT,
        proposal_id  UUID         REFERENCES play_session_proposals(id),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_session_games (
        session_id  UUID  NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
        game_id     INT   NOT NULL REFERENCES games(id)         ON DELETE CASCADE,
        status      TEXT  NOT NULL DEFAULT 'finished'
                          CHECK (status IN ('finished', 'abandoned')),

        PRIMARY KEY (session_id, game_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_session_game_results (
        session_id  UUID    NOT NULL,
        game_id     INT     NOT NULL,
        user_id     INT     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_winner   BOOLEAN NOT NULL DEFAULT false,

        PRIMARY KEY (session_id, game_id, user_id),
        FOREIGN KEY (session_id, game_id)
          REFERENCES play_session_games(session_id, game_id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_session_players (
        session_id  UUID  NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
        user_id     INT   NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
        notes       TEXT,

        PRIMARY KEY (session_id, user_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS play_photos (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id  UUID         NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
        uploaded_by TEXT         NOT NULL,
        key         TEXT         NOT NULL UNIQUE,
        size_bytes  INT          NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS invites (
        token_hash  TEXT         PRIMARY KEY,
        group_id    UUID         NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        role        TEXT         NOT NULL CHECK (role IN ('admin', 'member')),
        created_by  TEXT         NOT NULL,
        expires_at  TIMESTAMPTZ  NOT NULL,
        used_at     TIMESTAMPTZ,
        used_by     TEXT,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id           SERIAL       PRIMARY KEY,
        user_id      INT          REFERENCES users(id) ON DELETE SET NULL,
        action       TEXT         NOT NULL,
        target_type  TEXT,
        target_id    INT,
        metadata     JSONB,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
  }

  // Deliberately unsupported: this migration's job is "bring any database
  // up to the schema every entity already expects," including databases
  // that got there partly by hand before migrations existed. There's no
  // safe automatic reverse of that — a real 'down' would mean dropping
  // every table above, which is never what running 'migration:revert'
  // against this one specific migration should silently do.
  async down(): Promise<void> {
    throw new Error(
      'Baseline1787081098000 has no down migration — reverting it would mean dropping every table.',
    );
  }
}
