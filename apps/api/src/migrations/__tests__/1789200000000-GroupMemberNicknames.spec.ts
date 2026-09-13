import { GroupMemberNicknames1789200000000 } from '../1789200000000-GroupMemberNicknames';

describe('GroupMemberNicknames1789200000000', () => {
  it('adds and removes a nullable nickname column', async () => {
    const up: string[] = [];
    const down: string[] = [];
    const migration = new GroupMemberNicknames1789200000000();
    await migration.up({ query: async (sql: string) => { up.push(sql); } } as never);
    await migration.down({ query: async (sql: string) => { down.push(sql); } } as never);
    expect(up).toContain('ALTER TABLE group_members ADD COLUMN nickname TEXT');
    expect(down).toContain('ALTER TABLE group_members DROP COLUMN nickname');
  });
});
