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
    <div className="flex items-center gap-2">
      <div className="flex min-h-11 items-center rounded-sm border-[length:var(--border-w)] border-border bg-surface px-3 font-semibold">
        {loading ? 'Loading member...' : member?.username ?? 'Unknown member'}
      </div>
      <Button type="button" variant="ghost" onClick={() => router.back()}>Back</Button>
    </div>
  );
}
