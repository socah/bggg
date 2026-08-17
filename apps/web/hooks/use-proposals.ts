'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { Group, Proposal, ProposalWithGroup } from '@/lib/types';

// Cancelled proposals are never shown on the calendar (design spec's "What's
// shown" rule) — filtered here so both hooks below get it for free.
function isVisible(proposal: Proposal): boolean {
  return proposal.status !== 'cancelled';
}

async function fetchGroupProposals(groupId: string): Promise<Proposal[]> {
  const response = await apiFetch(`/groups/${groupId}/proposals`);
  const proposals: Proposal[] = await response.json();
  return proposals.filter(isVisible);
}

interface ProposalsResult<T> {
  proposals: T[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Group-level space: every non-cancelled proposal for one group.
export function useGroupProposals(groupId: string): ProposalsResult<Proposal> {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGroupProposals(groupId)
      .then((data) => {
        if (!cancelled) setProposals(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load this month's schedule");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, refreshKey]);

  return { proposals, loading, error, retry: () => setRefreshKey((k) => k + 1) };
}

// User-level space: fan out across every group the user belongs to and
// merge, tagging each proposal with its source group's name.
export function useAggregateProposals(): ProposalsResult<ProposalWithGroup> {
  const [proposals, setProposals] = useState<ProposalWithGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiFetch('/groups')
      .then((res) => res.json())
      .then(async (groups: Group[]) => {
        const perGroup = await Promise.all(
          groups.map(async (group) => {
            const groupProposals = await fetchGroupProposals(group.id);
            return groupProposals.map((proposal) => ({ ...proposal, groupName: group.name }));
          }),
        );
        if (!cancelled) setProposals(perGroup.flat());
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your schedule');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { proposals, loading, error, retry: () => setRefreshKey((k) => k + 1) };
}
