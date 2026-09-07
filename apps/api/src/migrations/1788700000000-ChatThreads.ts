import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ChatThreads1788700000000 implements MigrationInterface {
  name = 'ChatThreads1788700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "play_session_proposals" ADD CONSTRAINT "play_session_proposals_id_group_key" UNIQUE ("id", "group_id")`);
    await queryRunner.query(`
      CREATE TABLE "chat_threads" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "group_id" uuid NOT NULL,
        "kind" text NOT NULL,
        "proposal_id" uuid,
        "direct_user_a" text,
        "direct_user_b" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "chat_threads_kind_check" CHECK ("kind" IN ('general', 'proposal', 'direct')),
        CONSTRAINT "chat_threads_shape_check" CHECK (
          ("kind" = 'general' AND "proposal_id" IS NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
          ("kind" = 'proposal' AND "proposal_id" IS NOT NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
          ("kind" = 'direct' AND "proposal_id" IS NULL AND "direct_user_a" IS NOT NULL AND "direct_user_b" IS NOT NULL AND "direct_user_a" <= "direct_user_b")
        ),
        CONSTRAINT "chat_threads_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE,
        CONSTRAINT "chat_threads_proposal_group_fkey" FOREIGN KEY ("proposal_id", "group_id") REFERENCES "play_session_proposals"("id", "group_id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "chat_threads_general_unique" ON "chat_threads" ("group_id") WHERE "kind" = 'general'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "chat_threads_proposal_unique" ON "chat_threads" ("proposal_id") WHERE "kind" = 'proposal'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "chat_threads_direct_unique" ON "chat_threads" ("group_id", "direct_user_a", "direct_user_b") WHERE "kind" = 'direct'`);

    await queryRunner.query(`
      INSERT INTO "chat_threads" ("group_id", "kind", "created_at", "updated_at")
      SELECT groups."id", 'general', MIN(messages."created_at"), MAX(messages."created_at")
      FROM "messages" messages
      INNER JOIN "groups" groups ON groups."id"::text = messages."group_id"
      GROUP BY groups."id"
    `);
    // Legacy messages had no group foreign key. Preserve rows for groups that
    // were already deleted instead of silently discarding their history.
    await queryRunner.query(`
      CREATE TABLE "legacy_orphaned_messages" AS
      SELECT messages.*
      FROM "messages" messages
      LEFT JOIN "groups" groups ON groups."id"::text = messages."group_id"
      WHERE groups."id" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE "messages" ADD "thread_id" uuid`);
    await queryRunner.query(`
      UPDATE "messages" messages
      SET "thread_id" = threads."id"
      FROM "chat_threads" threads
      WHERE threads."kind" = 'general' AND threads."group_id"::text = messages."group_id"
    `);
    await queryRunner.query(`DELETE FROM "messages" WHERE "thread_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "thread_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "group_id"`);
    await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE`);
    await queryRunner.query(`CREATE INDEX "messages_thread_history_idx" ON "messages" ("thread_id", "created_at" DESC, "id" DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "messages_thread_history_idx"`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "group_id" text`);
    await queryRunner.query(`
      UPDATE "messages" messages
      SET "group_id" = threads."group_id"::text
      FROM "chat_threads" threads
      WHERE threads."id" = messages."thread_id"
    `);
    await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "group_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT "messages_thread_id_fkey"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "thread_id"`);
    await queryRunner.query(`
      INSERT INTO "messages" ("id", "group_id", "sender_id", "body", "created_at")
      SELECT "id", "group_id", "sender_id", "body", "created_at"
      FROM "legacy_orphaned_messages"
    `);
    await queryRunner.query(`DROP TABLE "chat_threads"`);
    await queryRunner.query(`ALTER TABLE "play_session_proposals" DROP CONSTRAINT "play_session_proposals_id_group_key"`);
    await queryRunner.query(`DROP TABLE "legacy_orphaned_messages"`);
  }
}
