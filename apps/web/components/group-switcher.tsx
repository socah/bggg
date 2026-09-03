'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { GROUP_DELETED_EVENT } from '@/lib/group-events';
import { parseSpacePath, spaceHref } from '@/lib/space';
import type { Group } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function GroupSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId: activeGroupId, tab: activeTab } = parseSpacePath(pathname);
  const tab = activeTab ?? 'calendar';

  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const deletedGroupIds = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    apiFetch('/groups')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load groups');
        return res.json();
      })
      .then((data: Group[]) => {
        if (!cancelled) setGroups(data.filter((group) => !deletedGroupIds.current.has(group.id)));
      })
      .catch(() => {
        // Keep whatever list was already loaded (possibly empty on first
        // load) rather than clearing it — group-switcher failures
        // shouldn't block navigation.
        if (!cancelled) setError('Could not load groups');
      });
    return () => {
      cancelled = true;
    };
  }, [activeGroupId]);

  useEffect(() => {
    function removeDeletedGroup(event: Event) {
      const { groupId } = (event as CustomEvent<{ groupId: string }>).detail;
      deletedGroupIds.current.add(groupId);
      setGroups((current) => current.filter((group) => group.id !== groupId));
    }

    window.addEventListener(GROUP_DELETED_EVENT, removeDeletedGroup);
    return () => window.removeEventListener(GROUP_DELETED_EVENT, removeDeletedGroup);
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
      setCreating(false);
      setError(null);
      router.push(spaceHref(created.id, tab));
    } catch {
      // apiFetch itself throws when the session is dead (it already
      // triggers a sign-out redirect in that case) — nothing more to show
      // the user here, but don't let it become an unhandled rejection.
      setError('Could not create group');
    }
  }

  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const activeLabel = activeGroup ? (activeGroup.isSolo ? 'Just Me' : activeGroup.name) : 'Personal (all groups)';

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu onOpenChange={(open) => !open && setCreating(false)}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" aria-label="Select group">
            {activeLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => router.push(spaceHref(null, tab))}>
          Personal (all groups)
        </DropdownMenuItem>
        {groups.map((group) => (
          <DropdownMenuItem key={group.id} onSelect={() => router.push(spaceHref(group.id, tab))}>
            {group.isSolo ? 'Just Me' : group.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {creating ? (
          <form onSubmit={handleCreateGroup} className="flex gap-1 p-1" onClick={(event) => event.stopPropagation()}>
            <Input
              autoFocus
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="New group name"
              className="w-32 text-xs"
            />
            <Button type="submit" variant="ghost" className="px-2 text-xs">
              Add
            </Button>
          </form>
        ) : (
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setCreating(true);
            }}
          >
            + New group
          </DropdownMenuItem>
        )}
        {error && <p className="px-2 py-1 text-xs text-accent">{error}</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      {activeGroup && !activeGroup.isSolo && (
        <Button asChild variant="ghost" aria-label="Group settings">
          <Link href={`/groups/${activeGroup.id}/settings`}>Settings</Link>
        </Button>
      )}
    </div>
  );
}
