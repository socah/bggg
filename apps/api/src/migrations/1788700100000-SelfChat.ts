import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SelfChat1788700100000 implements MigrationInterface {
  name = 'SelfChat1788700100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_shape_check"`);
    await queryRunner.query(`
      ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shape_check" CHECK (
        ("kind" = 'general' AND "proposal_id" IS NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'proposal' AND "proposal_id" IS NOT NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'direct' AND "proposal_id" IS NULL AND "direct_user_a" IS NOT NULL AND "direct_user_b" IS NOT NULL AND "direct_user_a" <= "direct_user_b")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "chat_threads" WHERE "kind" = 'direct' AND "direct_user_a" = "direct_user_b"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_shape_check"`);
    await queryRunner.query(`
      ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shape_check" CHECK (
        ("kind" = 'general' AND "proposal_id" IS NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'proposal' AND "proposal_id" IS NOT NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'direct' AND "proposal_id" IS NULL AND "direct_user_a" IS NOT NULL AND "direct_user_b" IS NOT NULL AND "direct_user_a" < "direct_user_b")
      )
    `);
  }
}
