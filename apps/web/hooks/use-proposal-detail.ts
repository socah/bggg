'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { ProposalDetail } from '@/lib/types';

interface UseProposalDetailResult {
  detail: ProposalDetail | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  retry: () => void;
}

// Deliberately separate from the panel's JSX (proposal-detail-panel.tsx) —
// see the design spec's non-goal note: future interactive controls (RSVP,
// vote, host) will consume this same fetched shape and trigger a refetch,
// rather than requiring the read-only panel to be rewritten.
export function useProposalDetail(proposalId: string | null): UseProposalDetailResult {
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!proposalId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);

    apiFetch(`/proposals/${proposalId}`)
      .then((response) => {
        if (response.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return response.json();
      })
      .then((data: ProposalDetail | null) => {
        if (!cancelled && data) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this proposal');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [proposalId, refreshKey]);

  return { detail, loading, notFound, error, retry: () => setRefreshKey((k) => k + 1) };
}
