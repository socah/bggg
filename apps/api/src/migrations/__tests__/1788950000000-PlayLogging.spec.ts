import { describe, expect, it, jest } from '@jest/globals';
import type { QueryRunner } from 'typeorm';
import { PlayLogging1788950000000 } from '../1788950000000-PlayLogging';

describe('PlayLogging1788950000000', () => {
  it('creates UUID plays, reusable guests, participant results, and play photos', async () => {
    const query = jest.fn<(sql: string) => Promise<void>>().mockResolvedValue(undefined);
    await new PlayLogging1788950000000().up({ query } as unknown as QueryRunner);
    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('ALTER TABLE play_session_games ADD COLUMN id UUID');
    expect(sql).toContain('CREATE TABLE guest_players');
    expect(sql).toContain('CREATE TABLE play_session_players');
    expect(sql).toContain('score TEXT');
    expect(sql).toContain('play_photos ADD COLUMN play_id');
  });
});
