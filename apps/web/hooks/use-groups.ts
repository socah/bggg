'use client';

import { useEffect, useState } from 'react';
import type { Group } from '@/lib/types';
import { fetchGroups, peekGroups } from '@/lib/groups-client';

interface UseGroupsResult {
  groups: Group[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useGroups(): UseGroupsResult {
  const [groups, setGroups] = useState<Group[]>(() => peekGroups() ?? []);
  const [loading, setLoading] = useState(() => peekGroups() === null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposals.ts).
    if (!peekGroups()) setLoading(true);
    setError(null);

    fetchGroups(true)
      .then((data) => {
        if (!cancelled) setGroups(data);
      })
      .catch(() => {
        if (!cancelled) {
          setGroups([]);
          setError('Could not load your groups');
        }
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
