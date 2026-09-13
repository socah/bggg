import { MigrationInterface, QueryRunner } from 'typeorm';

export class GroupMemberNicknames1789200000000 implements MigrationInterface {
  name = 'GroupMemberNicknames1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE group_members ADD COLUMN nickname TEXT');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE group_members DROP COLUMN nickname');
  }
}
