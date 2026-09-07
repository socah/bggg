import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProposalGameDownvotes1788870000000 implements MigrationInterface {
  name = 'ProposalGameDownvotes1788870000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "play_session_proposal_game_votes" ADD "value" smallint NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "play_session_proposal_game_votes" ADD CONSTRAINT "play_session_proposal_game_votes_value_check" CHECK ("value" IN (-1, 1))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "play_session_proposal_game_votes" DROP CONSTRAINT "play_session_proposal_game_votes_value_check"`);
    await queryRunner.query(`ALTER TABLE "play_session_proposal_game_votes" DROP COLUMN "value"`);
  }
}
