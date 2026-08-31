import { BggGamesCreatedAt1787604000000 } from '../1787604000000-BggGamesCreatedAt';

describe('BggGamesCreatedAt1787604000000', () => {
  it('adds the entity-required created_at column to games', async () => {
    const queries: string[] = [];
    const migration = new BggGamesCreatedAt1787604000000();
    await migration.up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as never);

    expect(queries.join('\n')).toContain(
      'ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
    );
  });
});
