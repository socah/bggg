import { BggCollections1787603000000 } from '../1787603000000-BggCollections';

describe('BggCollections1787603000000', () => {
  it('creates the account table and entity-compatible ownership schema', async () => {
    const queries: string[] = [];
    const migration = new BggCollections1787603000000();
    await migration.up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    expect(queries.join('\n')).toContain('CREATE TABLE IF NOT EXISTS bgg_accounts');
    expect(queries.join('\n')).toContain('CREATE TABLE game_ownership_bgg_migration');
    expect(queries.join('\n')).toContain('user_id   TEXT NOT NULL');
    expect(queries.join('\n')).toContain('ALTER TABLE game_ownership_bgg_migration RENAME TO game_ownership');
  });
});
