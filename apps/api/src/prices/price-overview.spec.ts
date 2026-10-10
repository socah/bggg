import { priceOverview, PriceSourceRow } from './price-overview';
import { PriceOffer } from './price-analysis';

const offer = (id: number, price: number): PriceOffer => ({ url: `https://boardgamegeek.com/market/product/${id}`, price, label: 'Good' });
const source = (offers: PriceOffer[]): PriceSourceRow => ({ source: 'market', offers, attempted_at: new Date(), fetched_at: new Date(), attribution: null, error: null });

describe('Reported marketplace exclusions', () => {
  it('discards only the flagged listing from live and historical prices', () => {
    const offers = [offer(1, 5), offer(2, 30), offer(3, 40)];
    const result = priceOverview([source(offers)], [{ source: 'market', day: '2026-10-10', offers }], new Set([offers[0].url]));
    expect(result.market.cheapest?.url).toBe(offers[1].url);
    expect(result.market.cheapest?.price).toBe(30);
    expect(result.market.excludedCount).toBe(1);
    expect(result.market.history[0]).toMatchObject({ price: 30, filteredPrice: 30, excludedCount: 1 });
  });

  it('keeps discarding the same listing after a provider refresh with a changed price', () => {
    const result = priceOverview([source([offer(1, 10), offer(2, 30)])], [], new Set([offer(1, 5).url]));
    expect(result.market.cheapest?.price).toBe(30);
  });

  it('clears the estimate rather than keeping a flagged sole listing', () => {
    const result = priceOverview([source([offer(1, 5)])], [], new Set([offer(1, 5).url]));
    expect(result.market.cheapest).toBeNull();
    expect(result.market.excludedCount).toBe(1);
    expect(result.bargain.price).toBeNull();
  });
});
