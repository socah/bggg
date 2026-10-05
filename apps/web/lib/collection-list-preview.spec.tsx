import { describe, expect, it } from '@jest/globals';
import { rankCollectionPreviewGames } from '@/lib/collection-list-preview';
import type { CollectionGame, PersonalReview } from '@/lib/types';

function game(id: number, wishlistPriority?: number, artwork = true): CollectionGame {
  return {
    id,
    bggId: 1000 + id,
    name: `Game ${id}`,
    image: artwork ? `/game-${id}.jpg` : null,
    thumbnail: null,
    minPlayers: 1,
    maxPlayers: 4,
    playingTime: 60,
    yearPublished: 2026,
    rating: 8,
    source: 'manual',
    addedAt: '2026-01-01',
    wishlistPriority,
  };
}

function review(gameId: number, rating: number): PersonalReview {
  return { id: gameId, gameId, rating, complexityScore: null, depthScore: null, body: null, source: 'manual', updatedAt: '' };
}

describe('rankCollectionPreviewGames', () => {
  it('places the highest user ratings first and randomizes unrated games daily', () => {
    const games = [game(1), game(2), game(3), game(4), game(5, undefined, false)];
    const reviews = [review(1, 7), review(2, 9)];
    const firstDay = rankCollectionPreviewGames(games, reviews, 'userRating', 'collection', new Date('2026-10-05T12:00:00Z'));
    const nextDay = rankCollectionPreviewGames(games, reviews, 'userRating', 'collection', new Date('2026-10-06T12:00:00Z'));

    expect(firstDay.slice(0, 2).map(({ id }) => id)).toEqual([2, 1]);
    expect(firstDay.slice(2).map(({ id }) => id)).not.toEqual(nextDay.slice(2).map(({ id }) => id));
    expect(firstDay.some(({ id }) => id === 5)).toBe(false);
  });

  it('orders wishlist priority tiers and changes the tied cutoff order daily', () => {
    const games = [game(1, 2), game(2, 1), game(3, 2), game(4, 3)];
    const firstDay = rankCollectionPreviewGames(games, [], 'wishlistPriority', 'wishlist', new Date('2026-10-05T12:00:00Z'));
    const nextDay = rankCollectionPreviewGames(games, [], 'wishlistPriority', 'wishlist', new Date('2026-10-06T12:00:00Z'));

    expect(firstDay[0].id).toBe(2);
    expect(firstDay.slice(1, 3).map(({ id }) => id).sort()).toEqual([1, 3]);
    expect(firstDay.slice(1, 3).map(({ id }) => id)).not.toEqual(nextDay.slice(1, 3).map(({ id }) => id));
    expect(firstDay[3].id).toBe(4);
  });
});
