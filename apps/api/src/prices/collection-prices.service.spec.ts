import { HttpService } from '@nestjs/axios';
import { DataSource } from 'typeorm';
import { BggService } from '../bgg/bgg.service';
import { PricesService } from './prices.service';

function setup() {
  const firstUrl = 'https://boardgamegeek.com/market/product/1';
  const secondUrl = 'https://boardgamegeek.com/market/product/2';
  const offers = [{ price: 20, url: firstUrl, label: 'Good' }, { price: 30, url: secondUrl, label: 'Good' }];
  const excluded: Array<{ game_id: number; url: string }> = [];
  const now = new Date();
  const sources = [
    { game_id: 1, source: 'market', offers, attempted_at: now, fetched_at: now, error: null },
    { game_id: 1, source: 'retail', offers: [{ price: 35, url: 'https://boardgameprices.co.uk/item/go', label: 'New' }], attempted_at: now, fetched_at: now, error: null },
  ];
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT id, bgg_id FROM games')) return [{ id: 1, bgg_id: 101 }];
    if (sql.includes('FROM game_ownership o JOIN games')) return params[0] === 'user-1'
      ? [{ id: 1, name: 'Azul', added_at: '2026-10-10', date_acquired: '2026-01-10', amount_paid: '40.00' }] : [];
    if (sql.startsWith('SELECT 1 AS found')) return offers.some((offer) => offer.url === params[1]) ? [{ found: 1 }] : [];
    if (sql.startsWith('INSERT INTO game_market_exclusions')) {
      if (!excluded.some((row) => row.url === params[1])) excluded.push({ game_id: params[0] as number, url: params[1] as string });
      return [];
    }
    if (sql.includes('FROM game_market_exclusions')) return excluded;
    if (sql.includes('FROM game_price_sources')) return sources;
    if (sql.includes('FROM game_price_history')) return [{ game_id: 1, source: 'market', day: '2026-10-10', offers }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const http = { get: jest.fn() };
  const bgg = { getMarketListings: jest.fn() };
  const service = new PricesService({ query } as unknown as DataSource, http as unknown as HttpService, bgg as unknown as BggService);
  return { service, query, http, bgg, excluded, firstUrl, secondUrl, sources };
}

describe('Collection pricing and marketplace reports', () => {
  it('uses the saved purchase price when neither current price source has an offer', async () => {
    const { service, sources } = setup();
    sources.forEach((source) => { source.offers = []; });
    const stats = await service.collectionStats('user-1');
    expect(stats.estimatedMarketValue).toBe(40);
    expect(stats.acquisitionFallbackCount).toBe(1);
    expect(stats.games[0]).toMatchObject({ estimatedValue: 40, basis: 'acquisition', stale: false });
  });

  it('immediately updates overview, history and collection valuation after discarding a listing', async () => {
    const { service, firstUrl, secondUrl, http, bgg } = setup();
    expect((await service.collectionStats('user-1')).estimatedMarketValue).toBe(20);
    const overview = await service.excludeMarketListing(1, firstUrl);
    expect(overview.market.cheapest?.url).toBe(secondUrl);
    expect(overview.market.history[0].filteredPrice).toBe(30);
    expect((await service.collectionStats('user-1')).estimatedMarketValue).toBe(30);
    expect(http.get).not.toHaveBeenCalled();
    expect(bgg.getMarketListings).not.toHaveBeenCalled();
  });

  it('revalues from depreciated retail if the remaining market offer exceeds retail', async () => {
    const { service, firstUrl, sources } = setup();
    sources[1].offers[0].price = 25;
    await service.excludeMarketListing(1, firstUrl);
    const stats = await service.collectionStats('user-1');
    expect(stats.estimatedMarketValue).toBe(18.75);
    expect(stats.games[0].basis).toBe('retail-minus-25-percent');
  });

  it('rejects unknown listing URLs and does not persist them', async () => {
    const { service, excluded } = setup();
    await expect(service.excludeMarketListing(1, 'https://boardgamegeek.com/market/product/999')).rejects.toThrow('not a known marketplace offer');
    expect(excluded).toEqual([]);
  });

  it('accepts repeated reports idempotently', async () => {
    const { service, firstUrl, excluded } = setup();
    await service.excludeMarketListing(1, firstUrl);
    await service.excludeMarketListing(1, firstUrl);
    expect(excluded).toHaveLength(1);
  });

  it('scopes owned games and acquisition data to the requesting user', async () => {
    const { service, query } = setup();
    const mine = await service.collectionStats('user-1');
    expect(mine.acquisitionValue).toBe(40);
    expect(mine.growth[0].month).toBe('2026-01');
    expect(query.mock.calls[0][0]).toContain('d.user_id = o.user_id');
    expect(query.mock.calls[0][0]).toContain('WHERE o.user_id = $1');
    expect(query.mock.calls[0][1]).toEqual(['user-1']);
    const other = await service.collectionStats('user-2');
    expect(other.gameCount).toBe(0);
    expect(other.acquisitionValue).toBe(0);
    expect(other.games).toEqual([]);
  });
});
