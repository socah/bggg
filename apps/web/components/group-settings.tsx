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
import { UserIdentityLink } from '@/components/user-identity-link';
import { Input } from '@/components/ui/input';
import { groupUsername } from '@/lib/user-identity';

function NicknameControl({ member, groupId, busy, onBusyChange, onSaved, onError }: { member: GroupMemberInfo; groupId: string; busy: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void; onError: (message: string) => void }) {
  const [nickname, setNickname] = useState(member.nickname ?? '');
  const unchanged = nickname.trim() === (member.nickname ?? '');

  return <div className="flex min-w-56 flex-1 items-center gap-2 sm:max-w-sm">
    <Input aria-label={`Nickname for ${groupUsername(member)}`} maxLength={100} value={nickname} disabled={busy} placeholder="Group nickname" onChange={(event) => setNickname(event.target.value)} />
    <Button type="button" variant="secondary" className="min-h-10 px-3" disabled={busy || unchanged} onClick={async () => {
      onBusyChange(true);
      try {
        await apiMutate(`/groups/${groupId}/members/${member.id}/nickname`, 'PATCH', { nickname: nickname.trim() || null });
        onSaved();
      } catch (error: unknown) {
        onError(error instanceof ApiError ? error.message : 'Unable to save nickname');
      } finally { onBusyChange(false); }
    }}>Save</Button>
  </div>;
}

export function GroupSettings({ groupId, currentUserId }: { groupId: string; currentUserId: string }) {
  const router = useRouter();
  const { members, loading, error, reload } = useGroupMembers(groupId);
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
    if (!window.confirm(`Remove ${groupUsername(member)} from this group?`)) return;
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
          {!loading && error && (
            <div className="p-4 text-sm text-accent" role="alert">
              {error}.{' '}
              <button type="button" onClick={reload} className="underline">Retry</button>
            </div>
          )}
          {!loading && members.map((member) => {
            const canManage = member.id !== currentUserId && member.role !== 'owner' &&
              (isOwner || (currentMember?.role === 'admin' && member.role === 'member'));
            return (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold"><UserIdentityLink user={member} groupId={groupId} /></p>
                  <p className="text-sm text-text-muted">{member.role}</p>
                </div>
                <NicknameControl key={`${member.id}:${member.nickname ?? ''}`} member={member} groupId={groupId} busy={busyUserId === member.id} onBusyChange={(busy) => setBusyUserId(busy ? member.id : null)} onSaved={reload} onError={setMessage} />
                {canManage && (
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {groupUsername(member)}</label>
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
                      {busyUserId === member.id ? 'Working…' : `Remove ${groupUsername(member)}`}
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
