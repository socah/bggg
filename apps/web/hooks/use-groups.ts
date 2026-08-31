'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { Group } from '@/lib/types';

interface UseGroupsResult {
  groups: Group[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useGroups(): UseGroupsResult {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposals.ts).
    setLoading(true);
    setError(null);

    apiFetch('/groups')
      .then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json();
      })
      .then((data: Group[]) => {
        if (!cancelled) setGroups(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your groups');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { groups, loading, error, retry: () => setRefreshKey((k) => k + 1) };
}
