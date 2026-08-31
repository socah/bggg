import { Migration202608311936381788204999691 } from '../1788204999691-Migration20260831193638';

describe('Migration20260831193638', () => {
  it('creates messages and preserves existing audit data while changing its identity columns', async () => {
    const queries: string[] = [];
    const migration = new Migration202608311936381788204999691();

    await migration.up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "messages"');
    expect(sql).toContain('UPDATE "audit_log"');
    expect(sql).toContain('ADD "actor_id" text');
    expect(sql).toContain('DROP COLUMN "user_id"');
    expect(sql).not.toContain('DROP COLUMN "name"');
    expect(sql).not.toContain('DROP COLUMN "created_at"');
  });
});
