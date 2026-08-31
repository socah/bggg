import type { MigrationInterface, QueryRunner } from 'typeorm';

// The generated diff for this migration was unsafe: it treated equivalent
// TEXT/varchar and TIMESTAMPTZ/timestamp metadata differences as drop-and-add
// operations. Keep this migration limited to the schema changes that are real.
export class Migration202608311936381788204999691 implements MigrationInterface {
  name = 'Migration202608311936381788204999691';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER SEQUENCE "game_ownership_bgg_migration_id_seq" RENAME TO "game_ownership_id_seq"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_ownership" ALTER COLUMN "added_at" SET DEFAULT now()::date`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_members" ALTER COLUMN "joined_at" SET DEFAULT now()::date`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "group_id" text NOT NULL,
        "sender_id" text NOT NULL,
        "body" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_fkey"`,
    );
    await queryRunner.query(`ALTER TABLE "audit_log" ADD "actor_id" text`);
    await queryRunner.query(`
      UPDATE "audit_log" AS log
      SET "actor_id" = COALESCE(users."keycloak_sub", log."user_id"::text, 'unknown')
      FROM "users" AS users
      WHERE users."id" = log."user_id"
    `);
    await queryRunner.query(
      `UPDATE "audit_log" SET "actor_id" = 'unknown' WHERE "actor_id" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ALTER COLUMN "actor_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "audit_log" SET "target_type" = 'unknown' WHERE "target_type" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ALTER COLUMN "target_type" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD "target_id_new" text`,
    );
    await queryRunner.query(
      `UPDATE "audit_log" SET "target_id_new" = COALESCE("target_id"::text, 'unknown')`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ALTER COLUMN "target_id_new" SET NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "audit_log" DROP COLUMN "target_id"`);
    await queryRunner.query(
      `ALTER TABLE "audit_log" RENAME COLUMN "target_id_new" TO "target_id"`,
    );
    await queryRunner.query(`ALTER TABLE "audit_log" DROP COLUMN "user_id"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER SEQUENCE "game_ownership_id_seq" RENAME TO "game_ownership_bgg_migration_id_seq"`,
    );
    await queryRunner.query(
      `ALTER TABLE "game_ownership" ALTER COLUMN "added_at" SET DEFAULT CURRENT_DATE`,
    );
    await queryRunner.query(
      `ALTER TABLE "group_members" ALTER COLUMN "joined_at" SET DEFAULT CURRENT_DATE`,
    );
    await queryRunner.query(`ALTER TABLE "audit_log" ADD "user_id" integer`);
    await queryRunner.query(`
      UPDATE "audit_log" AS log
      SET "user_id" = users."id"
      FROM "users" AS users
      WHERE users."keycloak_sub" = log."actor_id"
    `);
    await queryRunner.query(`ALTER TABLE "audit_log" DROP COLUMN "actor_id"`);
    await queryRunner.query(
      `ALTER TABLE "audit_log" ALTER COLUMN "target_type" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "audit_log" ADD "target_id_old" integer`);
    await queryRunner.query(`
      UPDATE "audit_log"
      SET "target_id_old" = CASE
        WHEN "target_id" ~ '^[0-9]+$' THEN "target_id"::integer
        ELSE NULL
      END
    `);
    await queryRunner.query(`ALTER TABLE "audit_log" DROP COLUMN "target_id"`);
    await queryRunner.query(
      `ALTER TABLE "audit_log" RENAME COLUMN "target_id_old" TO "target_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`DROP TABLE "messages"`);
  }
}
