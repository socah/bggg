export interface CollectionStats {
  currency: 'EUR';
  gameCount: number;
  acquisitionValue: number;
  acquisitionPriceCount: number;
  estimatedMarketValue: number | null;
  marketPriceCount: number;
  acquisitionFallbackCount: number;
  stalePriceCount: number;
  fallbackDateCount: number;
  growth: Array<{ month: string; acquired: number; collectionSize: number; recordedSpend: number }>;
  games: Array<{
    gameId: number;
    name: string;
    amountPaid: number | null;
    dateAcquired: string | null;
    addedAt: string;
    estimatedValue: number | null;
    basis: 'second-hand' | 'retail-minus-25-percent' | 'acquisition' | null;
    stale: boolean;
  }>;
}
