import { PushNotifications1789120000000 } from '../1789120000000-PushNotifications';

describe('PushNotifications migration', () => {
  it('creates subscriptions, preferences, and the user lookup index', async () => {
    const queries: string[] = [];
    await new PushNotifications1789120000000().up({
      query: async (sql: string) => { queries.push(sql); },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE TABLE "push_subscriptions"');
    expect(sql).toContain('CREATE TABLE "notification_preferences"');
    expect(sql).toContain('IDX_push_subscriptions_user_id');
    expect(sql).toContain('"show_message_previews" boolean NOT NULL DEFAULT false');
  });
});
