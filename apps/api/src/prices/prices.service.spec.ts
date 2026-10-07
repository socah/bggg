import { HttpService } from '@nestjs/axios';
import { DataSource, EntityManager } from 'typeorm';
import { of, throwError } from 'rxjs';
import { BggService } from '../bgg/bgg.service';
import { PricesService } from './prices.service';

describe('Price source cache and refresh', () => {
  function setup(cached = false) {
    const attempted = new Date();
    const read = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM games')) return Promise.resolve([{ id: 1, bgg_id: 101 }]);
      return Promise.resolve([]);
    });
    const write = jest.fn().mockImplementation((sql: string) => {
      if (cached && sql.startsWith('SELECT *')) return Promise.resolve([{ attempted_at: attempted }]);
      return Promise.resolve([]);
    });
    const transaction = jest.fn(async (callback: (manager: EntityManager) => Promise<void>) => {
      await callback({ query: write } as unknown as EntityManager);
    });
    const http = { get: jest.fn().mockReturnValue(of({ data: { currency: 'EUR', items: [] } })) };
    const bgg = { getMarketListings: jest.fn().mockResolvedValue([]) };
    const service = new PricesService({ query: read, transaction } as unknown as DataSource,
      http as unknown as HttpService, bgg as unknown as BggService);
    return { service, read, write, http, bgg };
  }

  it('uses the persisted cache for both sources without making upstream calls', async () => {
    const { service, http, bgg, write } = setup(true);
    await service.overview(1);
    expect(http.get).not.toHaveBeenCalled();
    expect(bgg.getMarketListings).not.toHaveBeenCalled();
    expect(write.mock.calls.filter(([sql]: [string]) => sql.includes('pg_advisory_xact_lock'))).toHaveLength(2);
  });

  it('requests Greece/EUR and records successful empty-market observations', async () => {
    const { service, http, bgg, write } = setup();
    await service.overview(1);
    const url = new URL(http.get.mock.calls[0][0] as string);
    expect(url.searchParams.get('eid')).toBe('101');
    expect(url.searchParams.get('destination')).toBe('GR');
    expect(url.searchParams.get('currency')).toBe('EUR');
    expect(url.searchParams.get('sort')).toBe('CHEAP1');
    expect(bgg.getMarketListings).toHaveBeenCalledWith(101);
    expect(write.mock.calls.filter(([sql]: [string]) => sql.includes('INSERT INTO game_price_history'))).toHaveLength(2);
  });

  it('does not overwrite successful offers or invent history when a provider fails', async () => {
    const { service, http, write } = setup();
    http.get.mockReturnValue(throwError(() => new Error('timeout')));
    await service.overview(1);
    const failure = write.mock.calls.find(([sql]: [string]) => sql.includes('attempted_at, error'));
    expect(failure?.[1][3]).toBe('Retail prices are temporarily unavailable.');
    expect(failure?.[0]).not.toContain('offers =');
    const snapshots = write.mock.calls.filter(([sql]: [string]) => sql.includes('INSERT INTO game_price_history'));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0][1][1]).toBe('market');
  });
});
