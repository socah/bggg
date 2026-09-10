import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PushNotifications1789120000000 implements MigrationInterface {
  name = 'PushNotifications1789120000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "push_subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" text NOT NULL,
        "endpoint" text NOT NULL UNIQUE,
        "p256dh" text NOT NULL,
        "auth" text NOT NULL,
        "expiration_time" bigint,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_push_subscriptions_user_id" ON "push_subscriptions" ("user_id")`);
    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "user_id" text PRIMARY KEY,
        "chat_messages" boolean NOT NULL DEFAULT true,
        "proposal_updates" boolean NOT NULL DEFAULT true,
        "show_message_previews" boolean NOT NULL DEFAULT false,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(`DROP INDEX "IDX_push_subscriptions_user_id"`);
    await queryRunner.query(`DROP TABLE "push_subscriptions"`);
  }
}
