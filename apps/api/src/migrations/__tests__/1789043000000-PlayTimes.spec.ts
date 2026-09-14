import { PlayTimes1789043000000 } from '../1789043000000-PlayTimes';

describe('PlayTimes1789043000000', () => {
  it('adds paired, ordered play timestamps', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new PlayTimes1789043000000().up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('started_at TIMESTAMPTZ');
    expect(sql).toContain('ended_at TIMESTAMPTZ');
    expect(sql).toContain('(started_at IS NULL) = (ended_at IS NULL)');
    expect(sql).toContain('ended_at > started_at');
  });
});
