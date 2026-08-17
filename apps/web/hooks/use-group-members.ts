'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { GroupMemberInfo } from '@/lib/types';

// The panel doesn't know ahead of time which group a proposal belongs to
// (in the aggregate space, it could be any of the user's groups) — so it
// fetches members for whichever group the loaded proposal turns out to
// belong to, rather than requiring a caller to plumb a groupId through.
export function useGroupMembers(groupId: string | null): GroupMemberInfo[] {
  const [members, setMembers] = useState<GroupMemberInfo[]>([]);

  useEffect(() => {
    if (!groupId) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    apiFetch(`/groups/${groupId}/members`)
      .then((res) => res.json())
      .then((data: GroupMemberInfo[]) => {
        if (!cancelled) setMembers(data);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return members;
}
