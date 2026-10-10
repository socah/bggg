import { MigrationInterface, QueryRunner } from 'typeorm';

export class GameMarketExclusions1791600200000 implements MigrationInterface {
  name = 'GameMarketExclusions1791600200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE game_market_exclusions (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (game_id, url)
    )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE game_market_exclusions');
  }
}
