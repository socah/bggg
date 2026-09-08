'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch, apiMutate } from '@/lib/api';
import type { AvailablePlace, ProposalPlaceSummary } from '@/lib/types';

export function useProposalPlaces(proposalId: string | null, onChanged?: () => void) {
  const [rows, setRows] = useState<ProposalPlaceSummary[]>([]);
  const [available, setAvailable] = useState<AvailablePlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposal-games.ts).
    setLoading(true);
    setError(null);
    Promise.all([
      proposalId
        ? apiFetch(`/proposals/${proposalId}/places`).then((response) => {
            if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
            return response.json();
          })
        : Promise.resolve([]),
      apiFetch('/places/saved').then((response) => {
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        return response.json();
      }),
    ])
      .then(([nextRows, nextAvailable]: [ProposalPlaceSummary[], AvailablePlace[]]) => {
        if (!cancelled) {
          setRows(nextRows);
          setAvailable(nextAvailable);
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load suggested places');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [proposalId, refreshKey]);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setPendingAction(key);
      setError(null);
      try {
        await action();
        setRefreshKey((value) => value + 1);
        onChanged?.();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong - try again');
      } finally {
        setPendingAction(null);
      }
    },
    [onChanged],
  );

  return {
    rows,
    available,
    loading,
    error,
    pendingAction,
    suggest: (input: { placeId: string } | { name: string }) =>
      run('suggest', () => apiMutate(`/proposals/${proposalId}/places`, 'POST', input)),
    vote: (id: string) =>
      run(`vote:${id}`, () => apiMutate(`/proposals/${proposalId}/places/${id}/votes`, 'POST')),
    downvote: (id: string) =>
      run(`downvote:${id}`, () => apiMutate(`/proposals/${proposalId}/places/${id}/downvotes`, 'POST')),
    unvote: (id: string) =>
      run(`unvote:${id}`, () => apiMutate(`/proposals/${proposalId}/places/${id}/votes`, 'DELETE')),
    removeSuggestion: (id: string) =>
      run(`remove:${id}`, () => apiMutate(`/proposals/${proposalId}/places/${id}`, 'DELETE')),
    removeSaved: (id: string) =>
      run(`remove-saved:${id}`, () => apiMutate(`/places/${id}/saved`, 'DELETE')),
    setOwned: (id: string, owned: boolean) =>
      run(`ownership:${id}`, () =>
        apiMutate(`/proposals/${proposalId}/places/${id}/ownership`, owned ? 'PUT' : 'DELETE'),
      ),
  };
}
