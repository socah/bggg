'use client';

import { useEffect, useState } from 'react';
import { CollectionBrowser } from '@/components/collection-browser';
import { apiFetch } from '@/lib/api';
import type { GroupMemberProfile } from '@/lib/types';

export function MemberCollection({ groupId, userId }: { groupId: string; userId: string }) {
  const [member, setMember] = useState<GroupMemberProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch(`/groups/${groupId}/members/${encodeURIComponent(userId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Member not found' : 'Unable to load member collection');
        return response.json() as Promise<GroupMemberProfile>;
      })
      .then((next) => { if (!cancelled) setMember(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load member collection'); });
    return () => { cancelled = true; };
  }, [groupId, userId]);

  if (error) return <p role="alert" className="text-sm text-accent">{error}</p>;
  if (!member) return <p role="status" className="text-sm text-text-muted">Loading member collection...</p>;

  return <CollectionBrowser collection={member.collection} wishlist={member.wishlist} saved={member.saved} lists={member.lists} />;
}
