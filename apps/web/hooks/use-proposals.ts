'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { Proposal, ProposalWithGroup } from '@/lib/types';
import { fetchGroups } from '@/lib/groups-client';

const groupProposalCache = new Map<string, Proposal[]>();
let aggregateProposalCache: ProposalWithGroup[] | null = null;

// Cancelled proposals are never shown on the calendar (design spec's "What's
// shown" rule) — filtered here so both hooks below get it for free.
function isVisible(proposal: Proposal): boolean {
  return proposal.status !== 'cancelled';
}

async function fetchGroupProposals(groupId: string): Promise<Proposal[]> {
  const response = await apiFetch(`/groups/${groupId}/proposals`);
  if (!response.ok) throw new Error('Failed to load proposals');
  const proposals: Proposal[] = await response.json();
  const visible = proposals.filter(isVisible);
  groupProposalCache.set(groupId, visible);
  return visible;
}

interface ProposalsResult<T> {
  proposals: T[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Group-level space: every non-cancelled proposal for one group.
export function useGroupProposals(groupId: string): ProposalsResult<Proposal> {
  const [proposals, setProposals] = useState<Proposal[]>(() => groupProposalCache.get(groupId) ?? []);
  const [loading, setLoading] = useState(() => !groupProposalCache.has(groupId));
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const loadedGroupId = useRef<string | null>(groupProposalCache.has(groupId) ? groupId : null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- changing groups resets stale data before the request starts. */
    if (loadedGroupId.current !== groupId) {
      setProposals([]);
      setLoading(true);
    }
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchGroupProposals(groupId)
      .then((data) => {
        if (!cancelled) {
          setProposals(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          groupProposalCache.delete(groupId);
          setProposals([]);
          setError("Could not load this month's schedule");
        }
      })
      .finally(() => {
        if (!cancelled) {
          loadedGroupId.current = groupId;
          setLoading(false);
        }
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
  const [proposals, setProposals] = useState<ProposalWithGroup[]>(() => aggregateProposalCache ?? []);
  const [loading, setLoading] = useState(() => aggregateProposalCache === null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoaded = useRef(aggregateProposalCache !== null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect -- the initial request resets request state synchronously. */
    if (!hasLoaded.current) setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    fetchGroups(true)
      .then(async (groups) => {
        const perGroup = await Promise.all(
          groups.map(async (group) => {
            const groupProposals = await fetchGroupProposals(group.id);
            return groupProposals.map((proposal) => ({ ...proposal, groupName: group.name }));
          }),
        );
        if (!cancelled) {
          aggregateProposalCache = perGroup.flat();
          setProposals(aggregateProposalCache);
        }
      })
      .catch(() => {
        if (!cancelled) {
          aggregateProposalCache = null;
          groupProposalCache.clear();
          setProposals([]);
          setError('Could not load your schedule');
        }
      })
      .finally(() => {
        if (!cancelled) {
          hasLoaded.current = true;
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { proposals, loading, error, retry: () => setRefreshKey((k) => k + 1) };
}
