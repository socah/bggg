import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BggCollections1787603000000 implements MigrationInterface {
  name = 'BggCollections1787603000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bgg_accounts (
        id            SERIAL       PRIMARY KEY,
        user_id       TEXT         NOT NULL UNIQUE,
        bgg_username  TEXT         NOT NULL,
        linked_at     TIMESTAMPTZ  NOT NULL,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS thumbnail TEXT,
        ADD COLUMN IF NOT EXISTS image TEXT,
        ADD COLUMN IF NOT EXISTS playing_time INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS year_published INT NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS rating NUMERIC(4,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'image_url') THEN
          UPDATE games SET image = COALESCE(image, image_url) WHERE image IS NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'max_playtime') THEN
          UPDATE games SET playing_time = COALESCE(NULLIF(max_playtime, 0), NULLIF(min_playtime, 0), 0) WHERE playing_time = 0;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'year') THEN
          UPDATE games SET year_published = COALESCE(year, 0) WHERE year_published = 0;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'games' AND column_name = 'bgg_rating') THEN
          UPDATE games SET rating = COALESCE(bgg_rating, 0) WHERE rating = 0;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE game_ownership_bgg_migration (
        id        SERIAL PRIMARY KEY,
        user_id   TEXT NOT NULL,
        game_id   INT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        added_at  DATE NOT NULL DEFAULT CURRENT_DATE,
        UNIQUE (user_id, game_id)
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'game_ownership'
            AND column_name = 'user_id'
            AND data_type = 'integer'
        ) THEN
          INSERT INTO game_ownership_bgg_migration (user_id, game_id, added_at)
          SELECT COALESCE(u.keycloak_sub, old.user_id::text), old.game_id, old.added_at
          FROM game_ownership old
          LEFT JOIN users u ON u.id = old.user_id
          ON CONFLICT (user_id, game_id) DO NOTHING;
        ELSE
          INSERT INTO game_ownership_bgg_migration (user_id, game_id, added_at)
          SELECT old.user_id, old.game_id, old.added_at
          FROM game_ownership old
          ON CONFLICT (user_id, game_id) DO NOTHING;
        END IF;
      END $$;
    `);
    await queryRunner.query(`DROP TABLE game_ownership`);
    await queryRunner.query(`ALTER TABLE game_ownership_bgg_migration RENAME TO game_ownership`);
  }

  async down(): Promise<void> {
    // This migration may convert legacy ownership identifiers and cannot
    // safely reconstruct the original integer foreign keys.
  }
}
