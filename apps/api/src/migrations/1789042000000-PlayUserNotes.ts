import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayUserNotes1789042000000 implements MigrationInterface {
  name = 'PlayUserNotes1789042000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE play_user_notes (
        play_id UUID NOT NULL REFERENCES play_session_games(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (play_id, user_id),
        CONSTRAINT chk_play_user_notes_length CHECK (LENGTH(notes) <= 5000)
      )
    `);
    await queryRunner.query(`
      INSERT INTO play_user_notes (play_id, user_id, notes)
      SELECT id, logged_by, notes
      FROM play_session_games
      WHERE notes IS NOT NULL AND BTRIM(notes) <> '' AND logged_by <> ''
      ON CONFLICT (play_id, user_id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE play_user_notes');
  }
}
