import type { CollectionGame, GameCardGame, PersonalReview } from '@/lib/types';

type PreviewMode = 'userRating' | 'wishlistPriority';

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function dailyOrder(games: GameCardGame[], seed: string, day: number): GameCardGame[] {
  const shuffled = [...games].sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`) || a.id - b.id);
  if (shuffled.length < 2) return shuffled;
  const offset = day % shuffled.length;
  return [...shuffled.slice(offset), ...shuffled.slice(0, offset)];
}

export function rankCollectionPreviewGames(
  games: Array<CollectionGame | GameCardGame>,
  reviews: PersonalReview[],
  mode: PreviewMode,
  seed: string,
  date = new Date(),
): GameCardGame[] {
  const reviewByGameId = new Map(reviews.map((review) => [review.gameId, review.rating]));
  const tiers = new Map<number, GameCardGame[]>();

  for (const game of games) {
    if (!game.thumbnail && !game.image) continue;
    const score = mode === 'wishlistPriority'
      ? ('wishlistPriority' in game ? game.wishlistPriority ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER)
      : reviewByGameId.get(game.id) ?? Number.NEGATIVE_INFINITY;
    const tier = tiers.get(score) ?? [];
    tier.push(game);
    tiers.set(score, tier);
  }

  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000);
  const scores = [...tiers.keys()].sort(mode === 'wishlistPriority' ? (a, b) => a - b : (a, b) => b - a);
  return scores.flatMap((score) => dailyOrder(tiers.get(score) ?? [], `${seed}:${score}`, day));
}
