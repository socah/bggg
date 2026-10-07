'use client';

import { WISHLIST_PRIORITIES, wishlistPriority } from '@/lib/wishlist-priority';
import type { CollectionGame } from '@/lib/types';

export function WishlistPrioritySelect({ game, busy, onChange }: {
  game: CollectionGame;
  busy?: boolean;
  onChange: (priority: number) => void;
}) {
  if (game.source === 'bgg') return null;
  return <select aria-label={`Wishlist priority for ${game.name}`} value={wishlistPriority(game).value} disabled={busy} onChange={(event) => onChange(Number(event.target.value))} className="min-h-9 max-w-full rounded-sm border border-border bg-surface-raised px-2 text-xs text-text">
    {WISHLIST_PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.value} · {priority.label}</option>)}
  </select>;
}
