'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { GroupLibraryGame } from '@/lib/types';

interface UseGroupLibraryResult {
  games: GroupLibraryGame[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useGroupLibrary(groupId: string | null): UseGroupLibraryResult {
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

    apiFetch(`/groups/${groupId}/games`)
      .then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json();
      })
      .then((data: GroupLibraryGame[]) => {
        if (!cancelled) setGames(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the group game library');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [groupId, refreshKey]);

  return {
    games,
    loading,
    error,
    reload: () => setRefreshKey((k) => k + 1),
  };
}
