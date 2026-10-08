'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { CollectionGame, GroupLibraryGame } from '@/lib/types';

interface UseGroupLibraryResult {
  games: GroupLibraryGame[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useGroupLibrary(groupId: string | null, { includeSaved = false }: { includeSaved?: boolean } = {}): UseGroupLibraryResult {
  const [games, setGames] = useState<GroupLibraryGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!groupId) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposals.ts); resets must land synchronously with the fetch start.
    setLoading(true);
    setError(null);

    Promise.all([
      apiFetch(`/groups/${groupId}/games`).then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json() as Promise<GroupLibraryGame[]>;
      }),
      includeSaved ? apiFetch('/bgg-account/saved').then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json() as Promise<CollectionGame[]>;
      }) : Promise.resolve([] as CollectionGame[]),
    ])
      .then(([owned, saved]) => {
        const gamesById = new Map(owned.map((game) => [game.id, game]));
        for (const game of saved) {
          if (!gamesById.has(game.id)) gamesById.set(game.id, { ...game, averageUserRating: null, averageComplexity: null, averageDepth: null });
        }
        if (!cancelled) setGames([...gamesById.values()]);
      })
      .catch(() => {
        if (!cancelled) setError(includeSaved ? 'Could not load owned and saved games' : 'Could not load the group game library');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupId, refreshKey, includeSaved]);

  return {
    games,
    loading,
    error,
    reload: () => setRefreshKey((k) => k + 1),
  };
}
