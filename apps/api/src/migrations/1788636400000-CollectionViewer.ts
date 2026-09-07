import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CollectionViewer1788636400000 implements MigrationInterface {
  name = 'CollectionViewer1788636400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "game_ownership" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'manual'`);
    await queryRunner.query(`ALTER TABLE "game_ownership" ADD CONSTRAINT "game_ownership_source_check" CHECK ("source" IN ('manual', 'bgg'))`);
    await queryRunner.query(`UPDATE "game_ownership" SET "source" = 'bgg'`);
    await queryRunner.query(`
      CREATE TABLE "game_wishlist" (
        "id" SERIAL NOT NULL,
        "user_id" text NOT NULL,
        "game_id" integer NOT NULL,
        "added_at" date NOT NULL DEFAULT CURRENT_DATE,
        "source" text NOT NULL DEFAULT 'manual' CHECK ("source" IN ('manual', 'bgg')),
        CONSTRAINT "game_wishlist_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "game_wishlist_user_game_key" UNIQUE ("user_id", "game_id"),
        CONSTRAINT "game_wishlist_game_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE
      )
    `);

    // Move the legacy users-table foreign key to the Keycloak subject used by
    // every active feature. Existing reviews retain their author's subject.
    await queryRunner.query(`ALTER TABLE "reviews" ADD COLUMN "keycloak_user_id" text`);
    await queryRunner.query(`UPDATE "reviews" r SET "keycloak_user_id" = u."keycloak_sub" FROM "users" u WHERE u."id" = r."user_id"`);
    await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "keycloak_user_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_user_id_fkey"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_user_id_game_id_key"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "user_id"`);
    await queryRunner.query(`ALTER TABLE "reviews" RENAME COLUMN "keycloak_user_id" TO "user_id"`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD COLUMN "updated_at" timestamptz NOT NULL DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_game_key" UNIQUE ("user_id", "game_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "reviews_user_game_key"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "updated_at"`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD COLUMN "legacy_user_id" integer`);
    await queryRunner.query(`UPDATE "reviews" r SET "legacy_user_id" = u."id" FROM "users" u WHERE u."keycloak_sub" = r."user_id"`);
    await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "legacy_user_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "user_id"`);
    await queryRunner.query(`ALTER TABLE "reviews" RENAME COLUMN "legacy_user_id" TO "user_id"`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_game_id_key" UNIQUE ("user_id", "game_id")`);
    await queryRunner.query(`DROP TABLE "game_wishlist"`);
    await queryRunner.query(`ALTER TABLE "game_ownership" DROP CONSTRAINT "game_ownership_source_check"`);
    await queryRunner.query(`ALTER TABLE "game_ownership" DROP COLUMN "source"`);
  }
}
