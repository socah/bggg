import { collectionStats, CollectionValueGame } from './collection-analysis';

const game = (overrides: Partial<CollectionValueGame> = {}): CollectionValueGame => ({
  id: 1, name: 'Azul', dateAcquired: '2026-01-15', addedAt: '2026-10-10', amountPaid: 40,
  marketPrice: 30, retailPrice: 50, stale: false, ...overrides,
});

describe('Collection growth and valuation', () => {
  it('uses second-hand prices unless they exceed retail, then depreciates retail by 25%', () => {
    const result = collectionStats([
      game(), game({ id: 2, marketPrice: 60, retailPrice: 40 }),
      game({ id: 3, marketPrice: 40, retailPrice: 40 }),
    ]);
    expect(result.games.map((entry) => entry.estimatedValue)).toEqual([30, 30, 40]);
    expect(result.games.map((entry) => entry.basis)).toEqual(['second-hand', 'retail-minus-25-percent', 'second-hand']);
    expect(result.estimatedMarketValue).toBe(100);
  });

  it('falls back to depreciated retail for missing market data and excludes unpriced games', () => {
    const result = collectionStats([
      game({ marketPrice: null, retailPrice: 39.99 }),
      game({ id: 2, marketPrice: null, retailPrice: null, amountPaid: null }),
      game({ id: 3, marketPrice: 20, retailPrice: null, amountPaid: 0, stale: true }),
    ]);
    expect(result.acquisitionValue).toBe(40);
    expect(result.acquisitionPriceCount).toBe(2);
    expect(result.estimatedMarketValue).toBe(49.99);
    expect(result.marketPriceCount).toBe(2);
    expect(result.stalePriceCount).toBe(1);
    expect(result.games[1].estimatedValue).toBeNull();
  });

  it('groups current acquisitions by date acquired, falling back to collection added date', () => {
    const result = collectionStats([
      game({ id: 1, dateAcquired: '2026-03-02', amountPaid: 15.10 }),
      game({ id: 2, dateAcquired: '2026-01-10', amountPaid: 0 }),
      game({ id: 3, dateAcquired: null, addedAt: '2026-03-20', amountPaid: 20.20 }),
    ]);
    expect(result.growth).toEqual([
      { month: '2026-01', acquired: 1, collectionSize: 1, recordedSpend: 0 },
      { month: '2026-03', acquired: 2, collectionSize: 3, recordedSpend: 35.3 },
    ]);
    expect(result.fallbackDateCount).toBe(1);
    expect(result.acquisitionValue).toBe(35.3);
  });

  it('represents an empty collection and absent market data without inventing a valuation', () => {
    expect(collectionStats([])).toMatchObject({ gameCount: 0, growth: [], acquisitionValue: 0, estimatedMarketValue: null });
    expect(collectionStats([game({ marketPrice: null, retailPrice: null })]).estimatedMarketValue).toBeNull();
  });
});
