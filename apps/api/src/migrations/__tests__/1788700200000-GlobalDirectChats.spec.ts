import { GlobalDirectChats1788700200000 } from '../1788700200000-GlobalDirectChats';

describe('GlobalDirectChats migration', () => {
  it('merges duplicate direct threads before enforcing global uniqueness', async () => {
    const queries: string[] = [];
    await new GlobalDirectChats1788700200000().up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toContain('FIRST_VALUE("id")');
    expect(sql).toContain('global_direct_message_origins');
    expect(sql).toContain('UPDATE "messages"');
    expect(sql).toContain('ALTER COLUMN "group_id" DROP NOT NULL');
    expect(sql).toContain('"kind" = \'direct\' AND "group_id" IS NULL');
    expect(sql).toContain('("direct_user_a", "direct_user_b")');
  });
});
