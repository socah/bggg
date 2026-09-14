import { PlayUserNotes1789042000000 } from '../1789042000000-PlayUserNotes';

describe('PlayUserNotes1789042000000', () => {
  it('creates user-owned play notes and backfills legacy notes to their logger', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new PlayUserNotes1789042000000().up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('PRIMARY KEY (play_id, user_id)');
    expect(sql).toContain('REFERENCES play_session_games(id) ON DELETE CASCADE');
    expect(sql).toContain('SELECT id, logged_by, notes');
    expect(sql).toContain("logged_by <> ''");
  });
});
