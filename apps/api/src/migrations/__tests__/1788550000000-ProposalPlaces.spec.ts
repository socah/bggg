import { ProposalPlaces1788550000000 } from '../1788550000000-ProposalPlaces';

describe('ProposalPlaces1788550000000', () => {
  it('creates place polling and durable session host tables, then backfills hosts', async () => {
    const queries: string[] = [];
    await new ProposalPlaces1788550000000().up({
      query: async (sql: string) => { queries.push(sql); },
    } as never);

    const sql = queries.join('\n');
    expect(sql).toContain('CREATE TABLE "places"');
    expect(sql).toContain('CREATE TABLE "place_owners"');
    expect(sql).toContain('CREATE TABLE "place_visibility"');
    expect(sql).toContain('CREATE TABLE "proposal_places"');
    expect(sql).toContain('CREATE TABLE "proposal_place_votes"');
    expect(sql).toContain('CREATE TABLE "play_session_hosts"');
    expect(sql).toContain('UNIQUE ("proposal_id", "place_id")');
    expect(sql).toContain('PRIMARY KEY ("proposal_place_id", "user_id")');
    expect(sql).toContain('PRIMARY KEY ("session_id", "user_id")');
    expect(sql).toContain('REFERENCES "play_sessions"("id") ON DELETE CASCADE');
    expect(sql).toContain('SELECT DISTINCT session."id", owner."user_id"');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('drops session hosts before the tables used to derive them', async () => {
    const queries: string[] = [];
    await new ProposalPlaces1788550000000().down({
      query: async (sql: string) => { queries.push(sql); },
    } as never);

    expect(queries[0]).toContain('DROP TABLE "play_session_hosts"');
    expect(queries).toHaveLength(6);
  });
});
