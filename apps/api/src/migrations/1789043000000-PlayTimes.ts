import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlayTimes1789043000000 implements MigrationInterface {
  name = 'PlayTimes1789043000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE play_session_games ADD COLUMN started_at TIMESTAMPTZ');
    await queryRunner.query('ALTER TABLE play_session_games ADD COLUMN ended_at TIMESTAMPTZ');
    await queryRunner.query('ALTER TABLE play_session_games ADD CONSTRAINT chk_play_times_together CHECK ((started_at IS NULL) = (ended_at IS NULL))');
    await queryRunner.query('ALTER TABLE play_session_games ADD CONSTRAINT chk_play_times_order CHECK (ended_at IS NULL OR ended_at > started_at)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE play_session_games DROP CONSTRAINT chk_play_times_order');
    await queryRunner.query('ALTER TABLE play_session_games DROP CONSTRAINT chk_play_times_together');
    await queryRunner.query('ALTER TABLE play_session_games DROP COLUMN ended_at');
    await queryRunner.query('ALTER TABLE play_session_games DROP COLUMN started_at');
  }
}
