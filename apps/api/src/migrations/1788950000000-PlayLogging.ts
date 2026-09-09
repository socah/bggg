import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayLogging1788950000000 implements MigrationInterface {
  name = 'PlayLogging1788950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS play_session_game_results');
    await queryRunner.query('DROP TABLE IF EXISTS play_session_players');
    await queryRunner.query('ALTER TABLE play_session_games DROP CONSTRAINT play_session_games_pkey');
    await queryRunner.query('ALTER TABLE play_session_games ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid()');
    await queryRunner.query("ALTER TABLE play_session_games ADD COLUMN duration_minutes INT CHECK (duration_minutes > 0 AND duration_minutes <= 10080)");
    await queryRunner.query('ALTER TABLE play_session_games ADD COLUMN notes TEXT');
    await queryRunner.query("ALTER TABLE play_session_games ADD COLUMN logged_by TEXT NOT NULL DEFAULT ''");
    await queryRunner.query('ALTER TABLE play_session_games ALTER COLUMN logged_by DROP DEFAULT');
    await queryRunner.query('ALTER TABLE play_session_games ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    await queryRunner.query('ALTER TABLE play_session_games ADD PRIMARY KEY (id)');
    await queryRunner.query('CREATE INDEX idx_play_session_games_session ON play_session_games(session_id)');
    await queryRunner.query(`
      CREATE TABLE guest_players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (LENGTH(BTRIM(name)) > 0),
        linked_user_id TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query('CREATE INDEX idx_guest_players_group ON guest_players(group_id)');
    await queryRunner.query(`
      CREATE TABLE play_session_players (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES play_sessions(id) ON DELETE CASCADE,
        user_id TEXT,
        guest_player_id UUID REFERENCES guest_players(id) ON DELETE RESTRICT,
        CONSTRAINT chk_play_session_player_identity CHECK ((user_id IS NULL) <> (guest_player_id IS NULL))
      )
    `);
    await queryRunner.query('CREATE UNIQUE INDEX uq_play_session_player_user ON play_session_players(session_id, user_id) WHERE user_id IS NOT NULL');
    await queryRunner.query('CREATE UNIQUE INDEX uq_play_session_player_guest ON play_session_players(session_id, guest_player_id) WHERE guest_player_id IS NOT NULL');
    await queryRunner.query(`
      CREATE TABLE play_session_game_results (
        play_id UUID NOT NULL REFERENCES play_session_games(id) ON DELETE CASCADE,
        session_player_id UUID NOT NULL REFERENCES play_session_players(id) ON DELETE CASCADE,
        is_winner BOOLEAN NOT NULL DEFAULT false,
        score TEXT,
        PRIMARY KEY (play_id, session_player_id)
      )
    `);
    await queryRunner.query('ALTER TABLE play_photos ADD COLUMN play_id UUID REFERENCES play_session_games(id) ON DELETE CASCADE');
    await queryRunner.query('CREATE INDEX idx_play_photos_play ON play_photos(play_id)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE play_photos DROP COLUMN play_id');
    await queryRunner.query('DROP TABLE play_session_game_results');
    await queryRunner.query('DROP TABLE play_session_players');
    await queryRunner.query('DROP TABLE guest_players');
    await queryRunner.query('DROP INDEX idx_play_session_games_session');
    await queryRunner.query('ALTER TABLE play_session_games DROP CONSTRAINT play_session_games_pkey');
    await queryRunner.query('ALTER TABLE play_session_games DROP COLUMN created_at');
    await queryRunner.query('ALTER TABLE play_session_games DROP COLUMN logged_by');
    await queryRunner.query('ALTER TABLE play_session_games DROP COLUMN notes');
    await queryRunner.query('ALTER TABLE play_session_games DROP COLUMN duration_minutes');
    await queryRunner.query('ALTER TABLE play_session_games DROP COLUMN id');
    await queryRunner.query('ALTER TABLE play_session_games ADD PRIMARY KEY (session_id, game_id)');
  }
}
