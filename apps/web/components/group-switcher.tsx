'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { parseSpacePath, spaceHref } from '@/lib/space';
import type { Group } from '@/lib/types';

export function GroupSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId: activeGroupId, tab } = parseSpacePath(pathname);

  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch('/groups')
      .then((res) => res.json())
      .then((data: Group[]) => {
        if (!cancelled) setGroups(data);
      })
      .catch(() => {
        // Keep whatever list was already loaded (possibly empty on first
        // load) rather than clearing it — see the design spec's error
        // handling: group-switcher failures shouldn't block navigation.
        if (!cancelled) setError('Could not load groups');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateGroup(event: FormEvent) {
    event.preventDefault();
    if (!newGroupName.trim()) return;

    try {
      const response = await apiFetch('/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName }),
      });
      if (!response.ok) {
        setError('Could not create group');
        return;
      }
      const created: Group = await response.json();
      setGroups((prev) => [...prev, created]);
      setNewGroupName('');
      setError(null);
      router.push(spaceHref(created.id, tab));
    } catch {
      // apiFetch itself throws when the session is dead (it already
      // triggers a sign-out redirect in that case) — nothing more to show
      // the user here, but don't let it become an unhandled rejection.
      setError('Could not create group');
    }
  }

  return (
    <div>
      <select
        aria-label="Select group"
        className="rounded border border-gray-300 px-2 py-1 text-sm"
        value={activeGroupId ?? ''}
        onChange={(event) => router.push(spaceHref(event.target.value || null, tab))}
      >
        <option value="">Personal (all groups)</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.isSolo ? 'Just Me' : group.name}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={handleCreateGroup} className="mt-1 flex gap-1">
        <input
          type="text"
          value={newGroupName}
          onChange={(event) => setNewGroupName(event.target.value)}
          placeholder="New group name"
          className="w-32 rounded border border-gray-300 px-1 text-xs"
        />
        <button type="submit" className="text-xs text-blue-600">
          + Add
        </button>
      </form>
    </div>
  );
}
