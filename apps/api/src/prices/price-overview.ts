import { bargainEstimate, cheapest, filterMarketOffers, PriceHistoryPoint, PriceOffer } from './price-analysis';
import { Attribution } from './retail-prices';

export type PriceSourceName = 'retail' | 'market';
export interface PriceSourceRow {
  source: PriceSourceName;
  attempted_at: Date;
  fetched_at: Date | null;
  offers: PriceOffer[];
  attribution: Attribution | null;
  error: string | null;
}
export interface PriceHistoryRow { source: PriceSourceName; day: string; offers: PriceOffer[] }

// Reports apply to the listing URL, including old observations and future fetches.
export function priceOverview(sources: PriceSourceRow[], history: PriceHistoryRow[], excludedUrls: Set<string>) {
  const eligible = (offers: PriceOffer[]) => offers.filter((offer) => !excludedUrls.has(offer.url));
  const marketRows = history.filter((row) => row.source === 'market');
  const reference = marketRows.slice(-90).flatMap((row) => filterMarketOffers(eligible(row.offers)).map((offer) => offer.price));
  const points = (source: PriceSourceName): PriceHistoryPoint[] => history.filter((row) => row.source === source).map((row) => {
    const raw = source === 'market' ? eligible(row.offers) : row.offers;
    const filtered = source === 'market' ? filterMarketOffers(raw, reference) : raw;
    return { date: row.day, price: cheapest(raw)?.price ?? null,
      filteredPrice: cheapest(filtered)?.price ?? null, offerCount: row.offers.length,
      excludedCount: row.offers.length - filtered.length };
  });
  const view = (source: PriceSourceName) => {
    const state = sources.find((row) => row.source === source);
    const offers = state?.offers ?? [];
    const filtered = source === 'market' ? filterMarketOffers(eligible(offers), reference) : offers;
    return { cheapest: cheapest(filtered), offerCount: offers.length, excludedCount: offers.length - filtered.length,
      fetchedAt: state?.fetched_at?.toISOString() ?? null,
      stale: !state?.fetched_at || Date.now() - state.fetched_at.getTime() > 86_400_000 || Boolean(state.error),
      error: state?.error ?? null, attribution: state?.attribution ?? null, history: points(source) };
  };
  const retail = view('retail');
  const market = view('market');
  return { currency: 'EUR' as const, destination: 'GR' as const, retail, market, bargain: bargainEstimate(market.history) };
}
