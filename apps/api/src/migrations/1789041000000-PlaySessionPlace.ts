import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlaySessionPlace1789041000000 implements MigrationInterface {
  name = 'PlaySessionPlace1789041000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE play_sessions ADD COLUMN place_id UUID REFERENCES places(id) ON DELETE SET NULL');
    await queryRunner.query('CREATE INDEX idx_play_sessions_place ON play_sessions(place_id)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_play_sessions_place');
    await queryRunner.query('ALTER TABLE play_sessions DROP COLUMN place_id');
  }
}
