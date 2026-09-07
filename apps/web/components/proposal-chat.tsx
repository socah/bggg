'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/api';
import type { ChatThread, GroupMemberInfo } from '@/lib/types';
import { ChatPanel } from '@/components/chat-panel';
import { Button } from '@/components/ui/button';

export function ProposalChat({
  groupId,
  proposalId,
  members,
}: {
  groupId: string;
  proposalId: string;
  members: GroupMemberInfo[];
}) {
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (thread) return;

    setLoading(true);
    setError(null);
    try {
      const response = await apiMutate(
        `/groups/${groupId}/chats/proposals/${proposalId}`,
        'POST',
      );
      setThread(await response.json() as ChatThread);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not open chat');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-t border-border pt-3 mt-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Discussion</h3>
        <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void toggle()}>
          {open ? 'Hide chat' : 'Open chat'}
        </Button>
      </div>
      {open && (
        <div className="mt-3">
          {loading && <p className="text-sm text-text-muted">Opening chat...</p>}
          {error && <p className="text-sm text-accent" role="alert">{error}</p>}
          {thread && <ChatPanel threadId={thread.id} members={members} compact />}
        </div>
      )}
    </div>
  );
}
