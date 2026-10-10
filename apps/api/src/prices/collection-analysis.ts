export interface CollectionValueGame {
  id: number;
  name: string;
  dateAcquired: string | null;
  addedAt: string;
  amountPaid: number | null;
  marketPrice: number | null;
  retailPrice: number | null;
  stale: boolean;
}

export function collectionStats(games: CollectionValueGame[]) {
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const values = games.map((game) => {
    const useRetail = game.retailPrice !== null && (game.marketPrice === null || game.marketPrice > game.retailPrice);
    const basis = useRetail ? 'retail-minus-25-percent' as const : game.marketPrice !== null ? 'second-hand' as const
      : game.amountPaid !== null ? 'acquisition' as const : null;
    return { gameId: game.id, name: game.name, amountPaid: game.amountPaid,
      dateAcquired: game.dateAcquired, addedAt: game.addedAt,
      estimatedValue: useRetail ? round(game.retailPrice! * 0.75) : game.marketPrice ?? game.amountPaid,
      basis,
      stale: basis !== null && basis !== 'acquisition' && game.stale };
  });
  const months = new Map<string, { acquired: number; recordedSpend: number }>();
  for (const game of games) {
    const month = (game.dateAcquired ?? game.addedAt).slice(0, 7);
    const entry = months.get(month) ?? { acquired: 0, recordedSpend: 0 };
    entry.acquired++;
    entry.recordedSpend += game.amountPaid ?? 0;
    months.set(month, entry);
  }
  let cumulativeCount = 0;
  let cumulativeSpend = 0;
  const growth = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, entry]) => {
    cumulativeCount += entry.acquired;
    cumulativeSpend += entry.recordedSpend;
    return { month, acquired: entry.acquired, collectionSize: cumulativeCount, recordedSpend: round(cumulativeSpend) };
  });
  const valued = values.filter((game) => game.estimatedValue !== null);
  return { currency: 'EUR' as const, gameCount: games.length,
    acquisitionValue: round(games.reduce((sum, game) => sum + (game.amountPaid ?? 0), 0)),
    acquisitionPriceCount: games.filter((game) => game.amountPaid !== null).length,
    estimatedMarketValue: valued.length ? round(valued.reduce((sum, game) => sum + game.estimatedValue!, 0)) : null,
    marketPriceCount: valued.filter((game) => game.basis !== 'acquisition').length,
    acquisitionFallbackCount: valued.filter((game) => game.basis === 'acquisition').length,
    stalePriceCount: valued.filter((game) => game.stale).length,
    fallbackDateCount: games.filter((game) => game.dateAcquired === null).length,
    growth, games: values };
}
