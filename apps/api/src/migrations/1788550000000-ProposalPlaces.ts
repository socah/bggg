import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProposalPlaces1788550000000 implements MigrationInterface {
  name = 'ProposalPlaces1788550000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "places" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "created_by" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "places_pkey" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "place_owners" (
        "place_id" uuid NOT NULL,
        "user_id" text NOT NULL,
        CONSTRAINT "place_owners_pkey" PRIMARY KEY ("place_id", "user_id"),
        CONSTRAINT "place_owners_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "place_visibility" (
        "place_id" uuid NOT NULL,
        "user_id" text NOT NULL,
        CONSTRAINT "place_visibility_pkey" PRIMARY KEY ("place_id", "user_id"),
        CONSTRAINT "place_visibility_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "proposal_places" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "proposal_id" uuid NOT NULL,
        "place_id" uuid NOT NULL,
        "proposed_by" text NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "proposal_places_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "proposal_places_proposal_id_place_id_key" UNIQUE ("proposal_id", "place_id"),
        CONSTRAINT "proposal_places_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "play_session_proposals"("id") ON DELETE CASCADE,
        CONSTRAINT "proposal_places_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "proposal_place_votes" (
        "proposal_place_id" uuid NOT NULL,
        "user_id" text NOT NULL,
        CONSTRAINT "proposal_place_votes_pkey" PRIMARY KEY ("proposal_place_id", "user_id"),
        CONSTRAINT "proposal_place_votes_proposal_place_id_fkey" FOREIGN KEY ("proposal_place_id") REFERENCES "proposal_places"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "play_session_hosts" (
        "session_id" uuid NOT NULL,
        "user_id" text NOT NULL,
        CONSTRAINT "play_session_hosts_pkey" PRIMARY KEY ("session_id", "user_id"),
        CONSTRAINT "play_session_hosts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "play_sessions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      INSERT INTO "play_session_hosts" ("session_id", "user_id")
      SELECT DISTINCT session."id", owner."user_id"
      FROM "play_sessions" session
      INNER JOIN "proposal_places" suggestion ON suggestion."proposal_id" = session."proposal_id"
      INNER JOIN "place_owners" owner ON owner."place_id" = suggestion."place_id"
      WHERE session."proposal_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "play_session_hosts"`);
    await queryRunner.query(`DROP TABLE "proposal_place_votes"`);
    await queryRunner.query(`DROP TABLE "proposal_places"`);
    await queryRunner.query(`DROP TABLE "place_visibility"`);
    await queryRunner.query(`DROP TABLE "place_owners"`);
    await queryRunner.query(`DROP TABLE "places"`);
  }
}
