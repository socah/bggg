import { MigrationInterface, QueryRunner } from 'typeorm';

export class GamePrices1791300000000 implements MigrationInterface {
  name = 'GamePrices1791300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE game_price_sources (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('retail', 'market')),
      attempted_at TIMESTAMPTZ NOT NULL,
      fetched_at TIMESTAMPTZ,
      offers JSONB NOT NULL DEFAULT '[]',
      attribution JSONB,
      error TEXT,
      PRIMARY KEY (game_id, source)
    )`);
    await queryRunner.query(`CREATE TABLE game_price_history (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK (source IN ('retail', 'market')),
      day DATE NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      offers JSONB NOT NULL,
      PRIMARY KEY (game_id, source, day)
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE game_price_history');
    await queryRunner.query('DROP TABLE game_price_sources');
  }
}
