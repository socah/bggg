'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiMutate, ApiError } from '@/lib/api';
import { announceGroupDeleted } from '@/lib/group-events';
import { useGroupMembers } from '@/hooks/use-group-members';
import type { GroupMemberInfo, MemberRole } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GroupInviteSettings } from '@/components/group-invite-settings';

export function GroupSettings({ groupId, currentUserId }: { groupId: string; currentUserId: string }) {
  const router = useRouter();
  const { members, loading, reload } = useGroupMembers(groupId);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const currentMember = members.find((member) => member.isCurrentUser) ??
    members.find((member) => member.id === currentUserId);
  const isOwner = currentMember?.role === 'owner';
  const canInvite = currentMember?.role === 'owner' || currentMember?.role === 'admin';

  async function changeRole(member: GroupMemberInfo, role: Exclude<MemberRole, 'owner'>) {
    setBusyUserId(member.id);
    setMessage(null);
    try {
      await apiMutate(`/groups/${groupId}/members/${member.id}`, 'PATCH', { role });
      reload();
    } catch (error: unknown) {
      setMessage(error instanceof ApiError ? error.message : 'Unable to change member role');
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(member: GroupMemberInfo) {
    if (!window.confirm(`Remove ${member.displayName} from this group?`)) return;
    setBusyUserId(member.id);
    setMessage(null);
    try {
      await apiMutate(`/groups/${groupId}/members/${member.id}`, 'DELETE');
      reload();
    } catch (error: unknown) {
      setMessage(error instanceof ApiError ? error.message : 'Unable to remove member');
    } finally {
      setBusyUserId(null);
    }
  }

  async function deleteGroup() {
    if (!window.confirm('Delete this group permanently?')) return;
    setMessage(null);
    try {
      await apiMutate(`/groups/${groupId}`, 'DELETE');
      announceGroupDeleted(groupId);
      router.push('/calendar');
      router.refresh();
    } catch (error: unknown) {
      setMessage(error instanceof ApiError ? error.message : 'Unable to delete group');
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section>
        <h2 className="font-display text-xl">Members</h2>
        <Card className="mt-4 divide-y divide-border p-0">
          {loading && <p className="p-4 text-sm text-text-muted">Loading members…</p>}
          {!loading && members.map((member) => {
            const canManage = member.id !== currentUserId && member.role !== 'owner' &&
              (isOwner || (currentMember?.role === 'admin' && member.role === 'member'));
            return (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{member.displayName}</p>
                  <p className="text-sm text-text-muted">{member.role}</p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.displayName}</label>
                    <select
                      id={`role-${member.id}`}
                      value={member.role}
                      disabled={busyUserId === member.id}
                      onChange={(event) => void changeRole(member, event.target.value as Exclude<MemberRole, 'owner'>)}
                      className="min-h-11 rounded-sm border border-border bg-surface px-2 text-sm"
                    >
                      <option value="member">member</option>
                      {isOwner && <option value="admin">admin</option>}
                    </select>
                    <Button type="button" variant="ghost" disabled={busyUserId === member.id} onClick={() => void removeMember(member)}>
                      {busyUserId === member.id ? 'Working…' : `Remove ${member.displayName}`}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
        {message && <p className="mt-3 text-sm text-accent" role="status">{message}</p>}
      </section>

      {canInvite && <section><h2 className="font-display text-xl">Invite members</h2><div className="mt-4"><GroupInviteSettings groupId={groupId} /></div></section>}

      {isOwner && (
        <section>
          <h2 className="font-display text-xl">Danger zone</h2>
          <Button type="button" variant="secondary" className="mt-4" onClick={() => void deleteGroup()}>Delete group</Button>
        </section>
      )}
    </div>
  );
}
