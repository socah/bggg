'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useChat } from '@/hooks/use-chat';
import type { GroupMemberInfo } from '@/lib/types';
import { Button } from '@/components/ui/button';

function messageAuthor(senderId: string, members: GroupMemberInfo[], currentUserId?: string) {
  if (senderId === currentUserId) return 'You';
  const member = members.find((candidate) => candidate.id === senderId);
  return member?.displayName || member?.username || 'Former member';
}

export function ChatPanel({
  threadId,
  members,
  compact = false,
}: {
  threadId: string;
  members: GroupMemberInfo[];
  compact?: boolean;
}) {
  const { data: session } = useSession();
  const { messages, ready, loading, sending, error, send } = useChat(threadId);
  const [body, setBody] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (await send(body)) setBody('');
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div
        aria-live="polite"
        className={`overflow-y-auto rounded-sm border border-border bg-surface p-3 ${compact ? 'h-56' : 'h-[min(60vh,36rem)]'}`}
      >
        {loading && <p className="text-sm text-text-muted">Loading messages...</p>}
        {!loading && messages.length === 0 && (
          <p className="text-sm text-text-muted">No messages yet. Start the conversation.</p>
        )}
        <ol className="space-y-3">
          {messages.map((message) => (
            <li key={message.id} className="text-sm">
              <div className="flex items-baseline gap-2">
                <strong className="font-medium">
                  {messageAuthor(message.senderId, members, session?.user?.id)}
                </strong>
                <time className="text-xs text-text-muted" dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <p className="whitespace-pre-wrap break-words text-text">{message.body}</p>
            </li>
          ))}
        </ol>
        <div ref={endRef} />
      </div>

      {error && <p className="mt-2 text-xs text-accent" role="alert">{error}</p>}
      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <label className="sr-only" htmlFor={`chat-message-${threadId}`}>Message</label>
        <input
          id={`chat-message-${threadId}`}
          value={body}
          maxLength={2000}
          onChange={(event) => setBody(event.target.value)}
          placeholder={ready ? 'Write a message...' : 'Connecting...'}
          disabled={!ready || sending}
          className="min-w-0 flex-1 rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
        />
        <Button type="submit" disabled={!ready || sending || !body.trim()}>
          {sending ? 'Sending...' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
