import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DeletedAccountSubjects1788870200000 implements MigrationInterface {
  name = 'DeletedAccountSubjects1788870200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "deleted_account_subjects" (
        "subject_hash" text PRIMARY KEY,
        "deleted_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "deleted_account_subjects"`);
  }
}
