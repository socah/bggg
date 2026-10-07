import type { CollectionGame, GameCardGame } from '@/lib/types';

export const WISHLIST_PRIORITIES = [
  { value: 1, label: 'Must have', accent: 'border-l-accent', badge: 'bg-accent text-accent-ink' },
  { value: 2, label: 'Love to have', accent: 'border-l-accent-2', badge: 'bg-accent-2 text-accent-2-ink' },
  { value: 3, label: 'Like to have', accent: 'border-l-text', badge: 'bg-text text-surface' },
  { value: 4, label: 'Thinking about it', accent: 'border-l-text-muted', badge: 'bg-surface text-text-muted' },
  { value: 5, label: "Don't buy this", accent: 'border-l-border', badge: 'bg-surface text-text-muted' },
];

export function wishlistPriority(game: GameCardGame) {
  return WISHLIST_PRIORITIES.find((priority) => priority.value === (game as CollectionGame).wishlistPriority) ?? WISHLIST_PRIORITIES[2];
}

export function compareWishlistPriority(a: GameCardGame, b: GameCardGame): number {
  return wishlistPriority(a).value - wishlistPriority(b).value;
}
