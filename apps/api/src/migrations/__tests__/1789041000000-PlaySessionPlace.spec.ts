import { PlaySessionPlace1789041000000 } from '../1789041000000-PlaySessionPlace';

describe('PlaySessionPlace1789041000000', () => {
  it('adds a nullable final place with safe deletion behavior', async () => {
    const queries: string[] = [];
    await new PlaySessionPlace1789041000000().up({ query: async (sql: string) => { queries.push(sql); } } as never);

    expect(queries.join('\n')).toContain('place_id UUID REFERENCES places(id) ON DELETE SET NULL');
    expect(queries.join('\n')).toContain('idx_play_sessions_place');
  });
});
