export interface PriceOffer {
  price: number;
  url: string;
  label: string;
  product?: number;
  shipping?: number;
  country?: string;
  language?: string;
  notes?: string;
}

export interface PriceHistoryPoint {
  date: string;
  price: number | null;
  filteredPrice: number | null;
  offerCount: number;
  excludedCount: number;
}

export const accessoryOnly = (text: string) => /\b(?:insert|inserts|sleeves|organizer|organisation|storage|replacement|promo|promos|accessory|accessories)\s*(?:only|alone)\b|\bonly\s+(?:the\s+)?(?:insert|sleeves|organizer|promo|accessories)\b|\b(?:no|without|not including)\s+(?:the\s+)?(?:base\s+)?game\b|\bempty\s+box\b/i.test(text);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Lower-tail filtering is deliberately conservative: a real sale should survive.
// Log prices make the threshold proportional for both cheap and expensive games.
export function filterMarketOffers(offers: PriceOffer[], referencePrices: number[] = []) {
  const complete = offers.filter((offer) => !accessoryOnly(offer.notes ?? ''));
  const prices = [...complete.map((offer) => offer.price), ...referencePrices].filter((price) => price > 0);
  if (prices.length < 4) return complete;
  const logs = prices.map(Math.log);
  const center = median(logs);
  const mad = median(logs.map((value) => Math.abs(value - center)));
  const floor = Math.exp(center - Math.max(Math.log(2.5), 3 * 1.4826 * mad));
  return complete.filter((offer) => offer.price >= floor);
}

export function cheapest(offers: PriceOffer[]): PriceOffer | null {
  return [...offers].sort((a, b) => a.price - b.price)[0] ?? null;
}

// Theil–Sen is resistant to isolated bad days. Fit one minimum per day, so a
// frequently refreshed game doesn't outweigh other days in the regression.
export function bargainEstimate(history: PriceHistoryPoint[], now = new Date()) {
  const day = 86_400_000;
  const points = history.filter((point) => point.filteredPrice !== null &&
    new Date(point.date).getTime() >= now.getTime() - 90 * day);
  const count = points.length;
  if (count < 5 || new Date(points[count - 1].date).getTime() - new Date(points[0].date).getTime() < 14 * day) {
    return { price: null, sampleDays: count, trend: [] as Array<{ date: string; price: number }> };
  }
  const origin = new Date(points[0].date).getTime();
  const xs = points.map((point) => (new Date(point.date).getTime() - origin) / day);
  const ys = points.map((point) => point.filteredPrice!);
  const slopes: number[] = [];
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    if (xs[j] !== xs[i]) slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
  }
  const slope = median(slopes);
  const intercept = median(ys.map((y, i) => y - slope * xs[i]));
  const predict = (date: string) => Math.round((intercept + slope * (new Date(date).getTime() - origin) / day) * 100) / 100;
  const today = now.toISOString().slice(0, 10);
  const price = predict(today);
  // Avoid presenting an extrapolated non-positive price as a bargain.
  return { price: price > 0 ? price : null, sampleDays: count,
    trend: [points[0].date, today].map((date) => ({ date, price: predict(date) })).filter((point) => point.price > 0) };
}
