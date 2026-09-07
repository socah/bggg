import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GlobalDirectChats1788700200000 implements MigrationInterface {
  name = 'GlobalDirectChats1788700200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "global_direct_thread_origins" AS
      SELECT
        "id" AS "thread_id", "group_id", "direct_user_a", "direct_user_b",
        "created_at", "updated_at"
      FROM "chat_threads"
      WHERE "kind" = 'direct'
    `);
    await queryRunner.query(`
      CREATE TABLE "global_direct_message_origins" AS
      SELECT messages."id" AS "message_id", messages."thread_id"
      FROM "messages" messages
      INNER JOIN "chat_threads" threads ON threads."id" = messages."thread_id"
      WHERE threads."kind" = 'direct'
    `);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id", FIRST_VALUE("id") OVER (
          PARTITION BY "direct_user_a", "direct_user_b"
          ORDER BY "created_at", "id"
        ) AS "canonical_id"
        FROM "chat_threads"
        WHERE "kind" = 'direct'
      )
      UPDATE "messages" messages
      SET "thread_id" = ranked."canonical_id"
      FROM ranked
      WHERE messages."thread_id" = ranked."id"
        AND ranked."id" <> ranked."canonical_id"
    `);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id", ROW_NUMBER() OVER (
          PARTITION BY "direct_user_a", "direct_user_b"
          ORDER BY "created_at", "id"
        ) AS position
        FROM "chat_threads"
        WHERE "kind" = 'direct'
      )
      DELETE FROM "chat_threads" threads
      USING ranked
      WHERE threads."id" = ranked."id" AND ranked.position > 1
    `);
    await queryRunner.query(`DROP INDEX "chat_threads_direct_unique"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_shape_check"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "group_id" DROP NOT NULL`);
    await queryRunner.query(`UPDATE "chat_threads" SET "group_id" = NULL WHERE "kind" = 'direct'`);
    await queryRunner.query(`
      ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shape_check" CHECK (
        ("kind" = 'general' AND "group_id" IS NOT NULL AND "proposal_id" IS NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'proposal' AND "group_id" IS NOT NULL AND "proposal_id" IS NOT NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'direct' AND "group_id" IS NULL AND "proposal_id" IS NULL AND "direct_user_a" IS NOT NULL AND "direct_user_b" IS NOT NULL AND "direct_user_a" <= "direct_user_b")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "chat_threads_direct_unique" ON "chat_threads" ("direct_user_a", "direct_user_b") WHERE "kind" = 'direct'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "chat_threads_direct_unique"`);
    await queryRunner.query(`ALTER TABLE "chat_threads" DROP CONSTRAINT "chat_threads_shape_check"`);
    await queryRunner.query(`
      UPDATE "chat_threads" threads
      SET "group_id" = COALESCE(
        (SELECT origins."group_id" FROM "global_direct_thread_origins" origins
          INNER JOIN "groups" origin_group ON origin_group."id" = origins."group_id"
          WHERE origins."direct_user_a" = threads."direct_user_a"
            AND origins."direct_user_b" = threads."direct_user_b"
          ORDER BY origins."created_at", origins."thread_id" LIMIT 1),
        (SELECT first_membership."group_id" FROM "group_members" first_membership
          INNER JOIN "group_members" second_membership ON second_membership."group_id" = first_membership."group_id"
          WHERE first_membership."user_id" = threads."direct_user_a"
            AND second_membership."user_id" = threads."direct_user_b" LIMIT 1)
      )
      WHERE threads."kind" = 'direct'
    `);
    await queryRunner.query(`
      INSERT INTO "chat_threads" (
        "id", "group_id", "kind", "direct_user_a", "direct_user_b", "created_at", "updated_at"
      )
      SELECT
        origins."thread_id", origins."group_id", 'direct', origins."direct_user_a",
        origins."direct_user_b", origins."created_at", origins."updated_at"
      FROM "global_direct_thread_origins" origins
      INNER JOIN "groups" origin_group ON origin_group."id" = origins."group_id"
      WHERE NOT EXISTS (
        SELECT 1 FROM "chat_threads" threads WHERE threads."id" = origins."thread_id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM "chat_threads" threads
        WHERE threads."group_id" = origins."group_id"
          AND threads."direct_user_a" = origins."direct_user_a"
          AND threads."direct_user_b" = origins."direct_user_b"
      )
    `);
    await queryRunner.query(`
      UPDATE "messages" messages
      SET "thread_id" = origins."thread_id"
      FROM "global_direct_message_origins" origins
      INNER JOIN "chat_threads" threads ON threads."id" = origins."thread_id"
      WHERE messages."id" = origins."message_id"
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM "chat_threads" WHERE "group_id" IS NULL) THEN
          RAISE EXCEPTION 'Cannot restore group-scoped direct chats without a group membership';
        END IF;
      END $$
    `);
    await queryRunner.query(`ALTER TABLE "chat_threads" ALTER COLUMN "group_id" SET NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shape_check" CHECK (
        ("kind" = 'general' AND "proposal_id" IS NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'proposal' AND "proposal_id" IS NOT NULL AND "direct_user_a" IS NULL AND "direct_user_b" IS NULL) OR
        ("kind" = 'direct' AND "proposal_id" IS NULL AND "direct_user_a" IS NOT NULL AND "direct_user_b" IS NOT NULL AND "direct_user_a" <= "direct_user_b")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "chat_threads_direct_unique" ON "chat_threads" ("group_id", "direct_user_a", "direct_user_b") WHERE "kind" = 'direct'`);
    await queryRunner.query(`DROP TABLE "global_direct_message_origins"`);
    await queryRunner.query(`DROP TABLE "global_direct_thread_origins"`);
  }
}
