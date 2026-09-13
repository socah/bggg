'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiFetch, apiMutate } from '@/lib/api';
import type { ProposalGameSummary } from '@/lib/types';

interface UseProposalGamesResult {
  rows: ProposalGameSummary[];
  loading: boolean;
  error: string | null;
  pendingAction: string | null;
  actionError: string | null;
  proposeGame: (gameId: number) => Promise<boolean>;
  vote: (proposalGameId: string) => Promise<boolean>;
  unvote: (proposalGameId: string) => Promise<boolean>;
  downvote: (proposalGameId: string) => Promise<boolean>;
  removeSuggestion: (proposalGameId: string) => Promise<boolean>;
  reload: () => void;
}

// Own fetch of the games list (rather than reading detail.games) keeps this
// hook independently refreshable — voting bumps only this list's data.
// Same shared pending/error channel design as use-proposal-actions.
export function useProposalGames(proposalId: string | null, onChanged?: () => void): UseProposalGamesResult {
  const [rows, setRows] = useState<ProposalGameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!proposalId) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- manual fetch-in-effect (see use-proposals.ts).
    setLoading(true);
    setError(null);

    apiFetch(`/proposals/${proposalId}/games`)
      .then((res) => {
        if (!res.ok) throw new Error(`Unexpected status ${res.status}`);
        return res.json();
      })
      .then((data: ProposalGameSummary[]) => {
        if (!cancelled) setRows(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load proposed games');
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
      setActionError(null);
      try {
        await action();
        setRefreshKey((k) => k + 1);
        onChanged?.();
        return true;
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong — try again');
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [onChanged],
  );

  const proposeGame = useCallback(
    (gameId: number) => run('propose', () => apiMutate(`/proposals/${proposalId}/games`, 'POST', { gameId })),
    [run, proposalId],
  );
  const vote = useCallback(
    (pgId: string) => run(`vote:${pgId}`, () => apiMutate(`/proposals/${proposalId}/games/${pgId}/votes`, 'POST')),
    [run, proposalId],
  );
  const unvote = useCallback(
    (pgId: string) => run(`unvote:${pgId}`, () => apiMutate(`/proposals/${proposalId}/games/${pgId}/votes`, 'DELETE')),
    [run, proposalId],
  );
  const downvote = useCallback(
    (pgId: string) => run(`downvote:${pgId}`, () => apiMutate(`/proposals/${proposalId}/games/${pgId}/downvotes`, 'POST')),
    [run, proposalId],
  );
  const removeSuggestion = useCallback(
    (pgId: string) => run(`remove:${pgId}`, () => apiMutate(`/proposals/${proposalId}/games/${pgId}`, 'DELETE')),
    [run, proposalId],
  );

  return {
    rows,
    loading,
    error,
    pendingAction,
    actionError,
    proposeGame,
    vote,
    unvote,
    downvote,
    removeSuggestion,
    reload: () => setRefreshKey((k) => k + 1),
  };
}
