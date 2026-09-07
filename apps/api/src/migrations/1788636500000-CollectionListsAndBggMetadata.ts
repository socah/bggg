import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CollectionListsAndBggMetadata1788636500000 implements MigrationInterface {
  name = 'CollectionListsAndBggMetadata1788636500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "game_wishlist"
        ADD COLUMN "wishlist_priority" integer NOT NULL DEFAULT 3,
        ADD CONSTRAINT "game_wishlist_priority_check" CHECK ("wishlist_priority" BETWEEN 1 AND 5)
    `);
    await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT IF EXISTS "reviews_rating_check"`);
    await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "rating" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "rating" TYPE numeric(4,2) USING "rating"::numeric`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 10)`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD COLUMN "source" text NOT NULL DEFAULT 'manual'`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "reviews_source_check" CHECK ("source" IN ('manual', 'bgg'))`);

    await queryRunner.query(`
      CREATE TABLE "personal_lists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "name" text NOT NULL,
        "type" text NOT NULL CHECK ("type" IN ('custom', 'tier')),
        "tiers" jsonb NOT NULL DEFAULT '["S","A","B","C","D"]'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "personal_lists_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "personal_list_items" (
        "id" SERIAL NOT NULL,
        "list_id" uuid NOT NULL,
        "game_id" integer NOT NULL,
        "tier" text,
        "position" integer NOT NULL CHECK ("position" >= 0),
        CONSTRAINT "personal_list_items_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "personal_list_items_list_game_key" UNIQUE ("list_id", "game_id"),
        CONSTRAINT "personal_list_items_list_fkey" FOREIGN KEY ("list_id") REFERENCES "personal_lists"("id") ON DELETE CASCADE,
        CONSTRAINT "personal_list_items_game_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "personal_list_items"`);
    await queryRunner.query(`DROP TABLE "personal_lists"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "reviews_source_check"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "source"`);
    await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "reviews_rating_check"`);
    await queryRunner.query(`DELETE FROM "reviews" WHERE "rating" IS NULL`);
    await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "rating" TYPE integer USING "rating"::integer`);
    await queryRunner.query(`ALTER TABLE "reviews" ALTER COLUMN "rating" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 10)`);
    await queryRunner.query(`ALTER TABLE "game_wishlist" DROP CONSTRAINT "game_wishlist_priority_check"`);
    await queryRunner.query(`ALTER TABLE "game_wishlist" DROP COLUMN "wishlist_priority"`);
  }
}
