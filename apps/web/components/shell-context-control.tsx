'use client';

import { usePathname, useRouter } from 'next/navigation';
import { GroupSwitcher } from '@/components/group-switcher';
import { Button } from '@/components/ui/button';
import { useGroupMembers } from '@/hooks/use-group-members';
import { parseSpacePath } from '@/lib/space';

export function ShellContextControl() {
  const pathname = usePathname();
  const router = useRouter();
  const { groupId, userId } = parseSpacePath(pathname);
  const { members, loading } = useGroupMembers(userId ? groupId : null);

  if (!groupId || !userId) return <GroupSwitcher />;

  const member = members.find((candidate) => candidate.id === userId);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-h-11 min-w-0 items-center rounded-sm border-[length:var(--border-w)] border-border bg-surface px-3 font-semibold">
        {loading ? 'Loading member...' : member ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            <span className="max-w-full truncate">{member.username}</span>
            {member.firstName && <span className="max-w-full truncate font-normal text-text-muted">a.k.a. {member.firstName}</span>}
            {member.bggUsername && <a className="max-w-full truncate font-normal text-accent-2 underline" href={`https://boardgamegeek.com/user/${encodeURIComponent(member.bggUsername)}`} target="_blank" rel="noreferrer">BGG: {member.bggUsername}</a>}
          </span>
        ) : 'Unknown member'}
      </div>
      <Button type="button" variant="ghost" onClick={() => router.back()}>Back</Button>
    </div>
  );
}
