import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProposalPlaceVotingAndSavedPlaces1788870400000 implements MigrationInterface {
  name = 'ProposalPlaceVotingAndSavedPlaces1788870400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "proposal_place_votes" ADD "value" smallint NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "proposal_place_votes" ADD CONSTRAINT "proposal_place_votes_value_check" CHECK ("value" IN (-1, 1))`);
    await queryRunner.query(`ALTER TABLE "place_visibility" ADD "hidden" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "place_visibility" DROP COLUMN "hidden"`);
    await queryRunner.query(`ALTER TABLE "proposal_place_votes" DROP CONSTRAINT "proposal_place_votes_value_check"`);
    await queryRunner.query(`ALTER TABLE "proposal_place_votes" DROP COLUMN "value"`);
  }
}
