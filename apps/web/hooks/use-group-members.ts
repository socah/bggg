'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { GroupMemberInfo } from '@/lib/types';

// The panel doesn't know ahead of time which group a proposal belongs to
// (in the aggregate space, it could be any of the user's groups) — so it
// fetches members for whichever group the loaded proposal turns out to
// belong to, rather than requiring a caller to plumb a groupId through.
interface GroupMembersResult {
  members: GroupMemberInfo[];
  loading: boolean;
  reload: () => void;
}

export function useGroupMembers(groupId: string | null): GroupMembersResult {
  const [members, setMembers] = useState<GroupMemberInfo[]>([]);
  const [loadedGroupId, setLoadedGroupId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Nothing to fetch — the return statement below already yields [] for
    // any null groupId, so there's no need to reset state here too (doing
    // so would be a synchronous setState directly in the effect body,
    // which react-hooks/set-state-in-effect correctly flags as avoidable).
    if (!groupId) return;

    let cancelled = false;
    apiFetch(`/groups/${groupId}/members`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load group members');
        return res.json();
      })
      .then((data: GroupMemberInfo[]) => {
        if (!cancelled) {
          setMembers(data);
          setLoadedGroupId(groupId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMembers([]);
          setLoadedGroupId(groupId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, refreshKey]);

  return {
    members: groupId && loadedGroupId === groupId ? members : [],
    loading: !!groupId && loadedGroupId !== groupId,
    reload: () => setRefreshKey((key) => key + 1),
  };
}
