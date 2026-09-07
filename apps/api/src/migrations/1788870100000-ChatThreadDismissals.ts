import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatThreadDismissals1788870100000 implements MigrationInterface {
  name = 'ChatThreadDismissals1788870100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chat_thread_dismissals" (
        "thread_id" uuid NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
        "user_id" text NOT NULL,
        CONSTRAINT "chat_thread_dismissals_pkey" PRIMARY KEY ("thread_id", "user_id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chat_thread_dismissals"`);
  }
}
