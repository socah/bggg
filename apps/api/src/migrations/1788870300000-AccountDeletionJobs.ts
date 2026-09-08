import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountDeletionJobs1788870300000 implements MigrationInterface {
  name = 'AccountDeletionJobs1788870300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "account_deletion_jobs" (
        "subject_id" text PRIMARY KEY,
        "tombstone" text NOT NULL UNIQUE,
        "identity_deleted" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_deletion_jobs"`);
  }
}
