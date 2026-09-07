'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiMutate } from '@/lib/api';
import type { ChatThread, GroupMemberInfo } from '@/lib/types';
import { ChatPanel } from '@/components/chat-panel';
import { Button } from '@/components/ui/button';

export function ProposalChat({
  groupId,
  proposalId,
  members,
  openOnDesktop = false,
}: {
  groupId: string;
  proposalId: string;
  members: GroupMemberInfo[];
  openOnDesktop?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThread = useCallback(async () => {
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
  }, [groupId, proposalId, thread]);

  useEffect(() => {
    if (!openOnDesktop || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 1024px)');
    function update() {
      setDesktop(media.matches);
      if (media.matches) void loadThread();
    }
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [loadThread, openOnDesktop]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    await loadThread();
  }

  const visible = desktop || open;

  return (
    <div className="border-t border-border pt-3 mt-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Discussion</h3>
        {desktop && error ? (
          <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void loadThread()}>Retry</Button>
        ) : !desktop ? (
          <Button type="button" variant="secondary" className="px-2 py-1 text-xs" onClick={() => void toggle()}>{open ? 'Hide chat' : 'Open chat'}</Button>
        ) : null}
      </div>
      {visible && (
        <div className="mt-3">
          {loading && <p className="text-sm text-text-muted">Opening chat...</p>}
          {error && <p className="text-sm text-accent" role="alert">{error}</p>}
          {thread && <ChatPanel threadId={thread.id} members={members} compact />}
        </div>
      )}
    </div>
  );
}
