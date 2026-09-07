import { SelfChat1788700100000 } from '../1788700100000-SelfChat';

describe('SelfChat migration', () => {
  it('allows a direct thread whose two participants are the same user', async () => {
    const queries: string[] = [];
    await new SelfChat1788700100000().up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toContain('DROP CONSTRAINT "chat_threads_shape_check"');
    expect(sql).toContain('"direct_user_a" <= "direct_user_b"');
  });
});
