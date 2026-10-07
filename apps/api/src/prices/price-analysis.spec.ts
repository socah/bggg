import { bargainEstimate, filterMarketOffers, PriceHistoryPoint, PriceOffer } from './price-analysis';

const offer = (price: number, notes = ''): PriceOffer => ({ price, notes, label: 'Game', url: 'https://boardgamegeek.com/market/product/1' });
const point = (date: string, price: number | null): PriceHistoryPoint => ({ date, price, filteredPrice: price, offerCount: 1, excludedCount: 0 });

describe('Market price analysis', () => {
  it('removes a cheap accessory outlier but keeps genuine discounts and complete bundles', () => {
    const offers = [offer(2), offer(20), offer(40), offer(42), offer(45), offer(50, 'Complete game with organizer and promo cards')];
    expect(filterMarketOffers(offers).map((entry) => entry.price)).toEqual([20, 40, 42, 45, 50]);
  });

  it('uses description evidence even for sparse markets', () => {
    expect(filterMarketOffers([offer(10, 'Insert only, no base game'), offer(30, 'Complete game with insert')])).toEqual([offer(30, 'Complete game with insert')]);
    expect(filterMarketOffers([offer(5)])).toEqual([offer(5)]);
  });

  it('uses historical reference prices to reject an isolated accessory', () => {
    expect(filterMarketOffers([offer(2)], [40, 41, 42, 40])).toEqual([]);
  });

  it('requires enough independent days and span before giving a bargain price', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(bargainEstimate([point('2026-10-01', 40)], now).price).toBeNull();
    expect(bargainEstimate([1, 2, 3, 4, 5].map((day) => point(`2026-10-0${day}`, 40)), now).price).toBeNull();
  });

  it('fits a declining trend despite one anomalous day and missing offers', () => {
    const history = [point('2026-09-01', 50), point('2026-09-06', 45), point('2026-09-11', 40),
      point('2026-09-16', 150), point('2026-09-21', 30), point('2026-09-26', null), point('2026-10-01', 20)];
    const estimate = bargainEstimate(history, new Date('2026-10-06T00:00:00Z'));
    expect(estimate.price).toBe(15);
    expect(estimate.sampleDays).toBe(6);
    expect(estimate.trend).toEqual([{ date: '2026-09-01', price: 50 }, { date: '2026-10-06', price: 15 }]);
  });

  it('excludes old observations and suppresses impossible negative extrapolations', () => {
    const history = [point('2026-01-01', 999), point('2026-09-01', 20), point('2026-09-06', 15),
      point('2026-09-11', 10), point('2026-09-16', 5), point('2026-09-21', 1)];
    const estimate = bargainEstimate(history, new Date('2026-10-07T00:00:00Z'));
    expect(estimate.price).toBeNull();
    expect(estimate.sampleDays).toBe(5);
  });
});
