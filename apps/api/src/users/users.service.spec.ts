import { createHash } from 'node:crypto';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('removes personal data while preserving and anonymizing play history', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('SELECT id, is_solo FROM groups')) return [{ id: 'group-1', is_solo: false }];
        if (sql.startsWith('SELECT user_id FROM group_members')) return [{ user_id: 'user-2' }];
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<void>) => callback(manager)),
      query: jest.fn(async (sql: string) => sql.startsWith('SELECT subject_id')
        ? [{ subject_id: 'user-1', tombstone: 'deleted:test', identity_deleted: false }]
        : []),
    };
    const keycloak = { deleteUser: jest.fn() };
    const service = new UsersService(dataSource as never, keycloak as never);

    await service.deleteAccount('user-1');

    expect(queries).toContain(`UPDATE groups SET owner_id = $2 WHERE id = $1`);
    expect(queries).toContain(`UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2`);
    expect(queries).toContain(`UPDATE play_session_hosts SET user_id = $2 WHERE user_id = $1`);
    expect(queries.some((sql) => /DELETE FROM play_sessions\b/.test(sql))).toBe(false);
    expect(queries.some((sql) => /DELETE FROM play_session_games\b/.test(sql))).toBe(false);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO deleted_account_subjects'),
      [createHash('sha256').update('user-1').digest('hex')],
    );
    expect(keycloak.deleteUser).toHaveBeenCalledWith('user-1');
  });

  it('keeps a solo group under the tombstone instead of transferring its database owner', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.startsWith('SELECT id, is_solo FROM groups')) return [{ id: 'solo-1', is_solo: true }];
        if (sql.startsWith('SELECT user_id FROM group_members')) return [{ user_id: 'user-2' }];
        return [];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback: (value: typeof manager) => Promise<void>) => callback(manager)),
      query: jest.fn(async (sql: string) => sql.startsWith('SELECT subject_id')
        ? [{ subject_id: 'user-1', tombstone: 'deleted:test', identity_deleted: false }]
        : []),
    };
    const service = new UsersService(dataSource as never, { deleteUser: jest.fn() } as never);

    await service.deleteAccount('user-1');

    const ownerUpdate = manager.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE groups SET owner_id'));
    expect(ownerUpdate?.[1][1]).toMatch(/^deleted:/);
    expect(ownerUpdate?.[1][1]).not.toBe('user-2');
  });
});
