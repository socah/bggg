import { ChatThreads1788700000000 } from '../1788700000000-ChatThreads';

describe('ChatThreads migration', () => {
  it('creates constrained threads and migrates existing group messages', async () => {
    const queries: string[] = [];
    await new ChatThreads1788700000000().up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE TABLE "chat_threads"');
    expect(sql).toContain('chat_threads_shape_check');
    expect(sql).toContain('chat_threads_direct_unique');
    expect(sql).toContain('chat_threads_proposal_group_fkey');
    expect(sql).toContain('INSERT INTO "chat_threads"');
    expect(sql).toContain('ADD "thread_id" uuid');
    expect(sql).toContain('messages_thread_history_idx');
    expect(sql).toContain('legacy_orphaned_messages');
    expect(sql).toContain('REFERENCES "chat_threads"("id") ON DELETE CASCADE');
  });
});
