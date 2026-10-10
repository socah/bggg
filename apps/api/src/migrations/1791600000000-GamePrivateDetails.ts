import { MigrationInterface, QueryRunner } from 'typeorm';

export class GamePrivateDetails1791600000000 implements MigrationInterface {
  name = 'GamePrivateDetails1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE game_private_details (
        user_id TEXT NOT NULL,
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        comment TEXT,
        amount_paid NUMERIC(12, 2),
        PRIMARY KEY (user_id, game_id),
        CONSTRAINT chk_game_private_comment_length CHECK (LENGTH(comment) <= 5000),
        CONSTRAINT chk_game_private_amount_paid CHECK (amount_paid >= 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE game_private_details');
  }
}
