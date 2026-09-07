'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useGroupMembers } from '@/hooks/use-group-members';
import { UserIdentityLink } from '@/components/user-identity-link';

interface GroupHostingStats {
  totalSessionCount: number;
  hosts: { userId: string; hostedSessionCount: number }[];
}

export function PersonalHostingStats() {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/users/me/hosting-stats')
      .then((response) => {
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        return response.json() as Promise<{ hostedSessionCount: number }>;
      })
      .then((stats) => {
        if (!cancelled) setCount(stats.hostedSessionCount);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="hosting-heading" className="max-w-xl rounded-md border border-border bg-surface-raised p-5 shadow-sm">
      <p className="font-mono text-xs uppercase tracking-widest text-text-muted">Game nights</p>
      <h1 id="hosting-heading" className="mt-1 font-display text-2xl text-text">Hosting</h1>
      {error ? (
        <p className="mt-4 text-sm text-accent" role="alert">Could not load hosting stats.</p>
      ) : (
        <div className="mt-5 flex items-end gap-3">
          <strong className="font-display text-5xl leading-none text-accent-2">{count ?? '...'}</strong>
          <span className="pb-1 text-sm text-text-muted">confirmed sessions hosted</span>
        </div>
      )}
    </section>
  );
}

export function MemberHostingStats({ groupId, userId }: { groupId: string; userId: string }) {
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/groups/${groupId}/members/${encodeURIComponent(userId)}/hosting-stats`)
      .then((response) => {
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        return response.json() as Promise<{ hostedSessionCount: number }>;
      })
      .then((stats) => { if (!cancelled) setCount(stats.hostedSessionCount); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [groupId, userId]);

  return (
    <section aria-labelledby="member-hosting-heading" className="max-w-xl rounded-md border border-border bg-surface-raised p-5 shadow-sm">
      <p className="font-mono text-xs uppercase tracking-widest text-text-muted">Group history</p>
      <h1 id="member-hosting-heading" className="mt-1 font-display text-2xl text-text">Hosting</h1>
      {error ? (
        <p className="mt-4 text-sm text-accent" role="alert">Could not load hosting stats.</p>
      ) : (
        <div className="mt-5 flex items-end gap-3">
          <strong className="font-display text-5xl leading-none text-accent-2">{count ?? '...'}</strong>
          <span className="pb-1 text-sm text-text-muted">confirmed sessions hosted in this group</span>
        </div>
      )}
    </section>
  );
}

export function GroupHostingStats({ groupId }: { groupId: string }) {
  const [stats, setStats] = useState<GroupHostingStats | null>(null);
  const [error, setError] = useState(false);
  const { members, loading: membersLoading } = useGroupMembers(groupId);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/groups/${groupId}/hosting-stats`)
      .then((response) => {
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        return response.json() as Promise<GroupHostingStats>;
      })
      .then((nextStats) => {
        if (!cancelled) setStats(nextStats);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <section aria-labelledby="group-hosting-heading" className="max-w-2xl rounded-md border border-border bg-surface-raised p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-text-muted">Group history</p>
          <h1 id="group-hosting-heading" className="mt-1 font-display text-2xl text-text">Hosting</h1>
        </div>
        <p className="text-sm text-text-muted">
          <strong className="font-display text-3xl text-accent-2">{stats?.totalSessionCount ?? '...'}</strong> sessions
        </p>
      </div>
      {error && <p className="mt-4 text-sm text-accent" role="alert">Could not load hosting stats.</p>}
      {!error && stats && stats.hosts.length === 0 && (
        <p className="mt-4 text-sm text-text-muted">No hosted sessions yet.</p>
      )}
      {!error && stats && stats.hosts.length > 0 && (
        <ol className="mt-4 space-y-2">
          {stats.hosts.map((host, index) => {
            const member = members.find((candidate) => candidate.id === host.userId);
            return <li key={host.userId} className="flex items-center gap-3 rounded-sm bg-surface px-3 py-2">
              <span className="w-6 font-mono text-xs text-text-muted">#{index + 1}</span>
              <span className="flex-1 font-medium">
                {membersLoading
                  ? 'Loading member...'
                  : member ? <UserIdentityLink user={member} groupId={groupId} /> : 'Former member'}
              </span>
              <strong className="font-mono text-accent-2">{host.hostedSessionCount}</strong>
            </li>;
          })}
        </ol>
      )}
    </section>
  );
}
