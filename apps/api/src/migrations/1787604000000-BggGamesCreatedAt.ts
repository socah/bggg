import type { MigrationInterface, QueryRunner } from 'typeorm';

// The BGG collections migration added the columns introduced by Game, but
// missed its @CreateDateColumn. Existing databases already recorded that
// migration as applied, so this reconciliation must be separate.
export class BggGamesCreatedAt1787604000000 implements MigrationInterface {
  name = 'BggGamesCreatedAt1787604000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE games
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
  }

  async down(): Promise<void> {
    // This column is required by the Game entity and is not safely removable.
  }
}
