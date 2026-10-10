import { MigrationInterface, QueryRunner } from 'typeorm';

export class GameDateAcquired1791600100000 implements MigrationInterface {
  name = 'GameDateAcquired1791600100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE game_private_details ADD COLUMN date_acquired DATE');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE game_private_details DROP COLUMN date_acquired');
  }
}
