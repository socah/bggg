import { MigrationInterface, QueryRunner } from 'typeorm';

export class GuestPlayerArchiving1789040000000 implements MigrationInterface {
  name = 'GuestPlayerArchiving1789040000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE guest_players ADD COLUMN archived_at TIMESTAMPTZ');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE guest_players DROP COLUMN archived_at');
  }
}
