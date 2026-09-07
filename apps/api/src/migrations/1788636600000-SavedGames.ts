import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SavedGames1788636600000 implements MigrationInterface {
  name = 'SavedGames1788636600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "game_saved" (
        "id" SERIAL NOT NULL,
        "user_id" text NOT NULL,
        "game_id" integer NOT NULL,
        "added_at" date NOT NULL DEFAULT CURRENT_DATE,
        "source" text NOT NULL DEFAULT 'manual',
        CONSTRAINT "game_saved_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "game_saved_source_check" CHECK ("source" IN ('manual', 'bgg')),
        CONSTRAINT "game_saved_user_game_key" UNIQUE ("user_id", "game_id"),
        CONSTRAINT "game_saved_game_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "game_saved"`);
  }
}
