'use client';

import { useState } from 'react';
import { apiMutate, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface GroupInviteSettingsProps {
  groupId: string;
}

export function GroupInviteSettings({ groupId }: GroupInviteSettingsProps) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'creating' | 'copying' | 'sharing'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function createInvite() {
    setStatus('creating');
    setMessage(null);
    try {
      const response = await apiMutate(`/groups/${groupId}/invites`, 'POST', { role: 'member' });
      const data = (await response.json()) as { inviteUrl: string };
      setInviteUrl(data.inviteUrl);
      setMessage('Invite created. This link can be used once and expires in 7 days.');
    } catch (error: unknown) {
      setMessage(error instanceof ApiError ? error.message : 'Unable to create invite');
    } finally {
      setStatus('idle');
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    setStatus('copying');
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMessage('Invite link copied.');
    } catch {
      setMessage('Unable to copy the invite link.');
    } finally {
      setStatus('idle');
    }
  }

  async function shareInvite() {
    if (!inviteUrl || !navigator.share) return;
    setStatus('sharing');
    try {
      await navigator.share({ title: 'Join my board game group', url: inviteUrl });
    } catch (error: unknown) {
      // Closing the native share sheet is not an error worth showing.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage('Unable to share the invite link.');
    } finally {
      setStatus('idle');
    }
  }

  const busy = status !== 'idle';

  return (
    <Card className="max-w-xl p-4">
      <p className="text-sm text-text-muted">
        Create a one-time link for someone to join this group as a member. The link expires after 7 days.
      </p>
      {inviteUrl && (
        <code className="mt-4 block break-all rounded-sm bg-surface p-2 text-xs">{inviteUrl}</code>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!inviteUrl ? (
          <Button type="button" disabled={busy} onClick={() => void createInvite()}>
            {status === 'creating' ? 'Creating…' : 'Create invite link'}
          </Button>
        ) : (
          <>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void copyInvite()}>
              {status === 'copying' ? 'Copying…' : 'Copy link'}
            </Button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void shareInvite()}>
                {status === 'sharing' ? 'Sharing…' : 'Share'}
              </Button>
            )}
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void createInvite()}>
              New link
            </Button>
          </>
        )}
      </div>
      {message && <p className="mt-3 text-sm text-text-muted" role="status">{message}</p>}
    </Card>
  );
}
