export interface PriceOffer {
  price: number;
  url: string;
  label: string;
  product?: number;
  shipping?: number;
  country?: string;
  language?: string;
}

export interface PricePoint {
  date: string;
  price: number | null;
  filteredPrice: number | null;
  offerCount: number;
  excludedCount: number;
}

export interface PriceSource {
  cheapest: PriceOffer | null;
  offerCount: number;
  excludedCount: number;
  fetchedAt: string | null;
  stale: boolean;
  error: string | null;
  attribution: { name: string; url: string; logo: string } | null;
  history: PricePoint[];
}

export interface PriceOverview {
  currency: 'EUR';
  destination: 'GR';
  retail: PriceSource;
  market: PriceSource;
  bargain: { price: number | null; sampleDays: number; trend: Array<{ date: string; price: number }> };
}
