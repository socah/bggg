'use client';

import { useEffect, useState } from 'react';
import { apiFetch, apiMutate } from '@/lib/api';
import { formatDateDmy } from '@/lib/datetime';
import type {
  ChatThread,
  ChatThreadSummary,
  Group,
  GroupMemberInfo,
  Proposal,
} from '@/lib/types';
import { ChatPanel } from '@/components/chat-panel';

interface ChatContext {
  group: Group;
  members: GroupMemberInfo[];
  proposals: Proposal[];
  threads: ChatThreadSummary[];
}

interface LocatedThread {
  context: ChatContext | null;
  thread: ChatThreadSummary;
}

function threadCounterpart(thread: ChatThread, currentUserId: string | undefined) {
  return thread.directUserA === currentUserId ? thread.directUserB : thread.directUserA;
}

async function loadContext(group: Group): Promise<ChatContext> {
  const [chatResponse, memberResponse, proposalResponse] = await Promise.all([
    apiFetch(`/groups/${group.id}/chats`),
    apiFetch(`/groups/${group.id}/members`),
    apiFetch(`/groups/${group.id}/proposals`),
  ]);
  if (!chatResponse.ok || !memberResponse.ok || !proposalResponse.ok) {
    throw new Error('Could not load chats');
  }
  return {
    group,
    threads: await chatResponse.json() as ChatThreadSummary[],
    members: await memberResponse.json() as GroupMemberInfo[],
    proposals: await proposalResponse.json() as Proposal[],
  };
}

export function GroupChatView({ groupId }: { groupId: string | null }) {
  const [contexts, setContexts] = useState<ChatContext[]>([]);
  const [directThreads, setDirectThreads] = useState<ChatThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHiddenProposalChats, setShowHiddenProposalChats] = useState(false);
  const loadKey = groupId ?? 'all';

  useEffect(() => {
    let cancelled = false;

    const groupsRequest = groupId
      ? apiFetch(`/groups/${groupId}`).then(async (response) => {
        if (!response.ok) throw new Error('Could not load group');
        return [await response.json() as Group];
      })
      : apiFetch('/groups').then(async (response) => {
        if (!response.ok) throw new Error('Could not load groups');
        return response.json() as Promise<Group[]>;
      });

    groupsRequest
      .then(async (groups) => {
        const [nextContexts, nextDirectThreads] = await Promise.all([
          Promise.all(groups.map(loadContext)),
          groupId
            ? Promise.resolve([])
            : apiFetch('/chats').then(async (response) => {
              if (!response.ok) throw new Error('Could not load direct chats');
              return response.json() as Promise<ChatThreadSummary[]>;
            }),
        ]);
        return { nextContexts, nextDirectThreads };
      })
      .then(({ nextContexts, nextDirectThreads }) => {
        if (cancelled) return;
        setContexts(nextContexts);
        setDirectThreads(nextDirectThreads);
        const allThreads = [
          ...nextContexts.flatMap((context) => context.threads),
          ...nextDirectThreads,
        ];
        const initial = groupId
          ? allThreads.find((thread) => thread.kind === 'general')
          : [...allThreads].sort((a, b) => {
            const aTime = a.lastMessage?.createdAt ?? a.updatedAt;
            const bTime = b.lastMessage?.createdAt ?? b.updatedAt;
            return new Date(bTime).getTime() - new Date(aTime).getTime();
          })[0];
        setSelectedId(initial?.id ?? null);
        setLoadedKey(loadKey);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load chats');
          setLoadedKey(loadKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [groupId, loadKey]);

  async function openDirect(userId: string) {
    setError(null);
    try {
      const response = await apiMutate(
        `/chats/direct/${encodeURIComponent(userId)}`,
        'POST',
      );
      const thread = await response.json() as ChatThread;
      setDirectThreads((current) => current.some(({ id }) => id === thread.id)
        ? current
        : [...current, { ...thread, lastMessage: null }]);
      setSelectedId(thread.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start chat');
    }
  }

  async function removeDirect(threadId: string) {
    if (!window.confirm('Remove this chat from your chat list?')) return;
    setError(null);
    try {
      await apiMutate(`/chats/${threadId}`, 'DELETE');
      setDirectThreads((current) => current.filter((thread) => thread.id !== threadId));
      setSelectedId(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not remove chat');
    }
  }

  const locatedThreads: LocatedThread[] = contexts.flatMap((context) =>
    context.threads.map((thread) => ({ context, thread })),
  );
  if (!groupId) {
    locatedThreads.push(...directThreads.map((thread) => ({ context: null, thread })));
  }
  const contacts = [...new Map(
    contexts.flatMap((context) => context.members).map((member) => [member.id, member]),
  ).values()];
  const currentUserId = contacts.find((member) => member.isCurrentUser)?.id;
  const directContacts = contacts.filter((member) =>
    member.username !== 'unknown-member'
      || directThreads.some((thread) => threadCounterpart(thread, currentUserId) === member.id),
  );
  const selected = locatedThreads.find(({ thread }) => thread.id === selectedId) ?? null;
  const selectedDirectId = selected?.thread.kind === 'direct'
    ? threadCounterpart(selected.thread, currentUserId)
    : null;
  const selectedProposal = selected?.thread.proposalId
    ? selected.context?.proposals.find((proposal) => proposal.id === selected.thread.proposalId)
    : null;
  const selectedMember = contacts.find((member) => member.id === selectedDirectId);
  const selectedTitle = selected?.thread.kind === 'direct'
    ? selectedDirectId === currentUserId
      ? 'Notes to self'
      : (selectedMember?.displayName || selectedMember?.username || 'Direct message')
    : selected?.thread.kind === 'proposal'
      ? `Proposal: ${selectedProposal ? formatDateDmy(selectedProposal.proposedDate) : 'discussion'}`
      : 'General';
  const hiddenBefore = new Date();
  hiddenBefore.setDate(hiddenBefore.getDate() - 7);
  const hiddenBeforeKey = `${hiddenBefore.getFullYear()}-${String(hiddenBefore.getMonth() + 1).padStart(2, '0')}-${String(hiddenBefore.getDate()).padStart(2, '0')}`;

  if (loadedKey !== loadKey) {
    return <p className="text-sm text-text-muted">Loading chats...</p>;
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-display text-xl">Chat</h1>
        <p className="text-sm text-text-muted">
          {groupId ? 'Group conversations and direct messages.' : 'All conversations across your groups.'}
        </p>
      </div>
      {error && <p className="mb-3 text-sm text-accent" role="alert">{error}</p>}

      <div className="grid min-h-0 gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Chats" className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface-raised p-3 md:max-h-none">
          {contexts.map((context) => {
            const general = context.threads.find((thread) => thread.kind === 'general');
            const proposalThreads = context.threads.filter((thread) => thread.kind === 'proposal');
            const hiddenProposalThreads = proposalThreads.filter((thread) => {
              const proposal = context.proposals.find((candidate) => candidate.id === thread.proposalId);
              return Boolean(proposal && proposal.proposedDate < hiddenBeforeKey);
            });
            const shownProposalThreads = showHiddenProposalChats
              ? proposalThreads
              : proposalThreads.filter((thread) => !hiddenProposalThreads.some((hidden) => hidden.id === thread.id));
            return (
              <section key={context.group.id} className="mb-4 last:mb-0">
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  {context.group.isSolo ? 'Just Me' : context.group.name}
                </h2>
                {general && (
                  <button
                    type="button"
                    onClick={() => setSelectedId(general.id)}
                    className={`w-full rounded-sm px-2 py-2 text-left text-sm ${selected?.thread.id === general.id ? 'bg-highlight font-semibold' : 'hover:bg-surface'}`}
                  >
                    General
                  </button>
                )}
                {shownProposalThreads.map((thread) => {
                  const proposal = context.proposals.find((candidate) => candidate.id === thread.proposalId);
                  return (
                    <button
                      type="button"
                      key={thread.id}
                      onClick={() => setSelectedId(thread.id)}
                      className={`w-full rounded-sm px-2 py-2 text-left text-sm ${selected?.thread.id === thread.id ? 'bg-highlight font-semibold' : 'hover:bg-surface'}`}
                    >
                      Proposal: {proposal ? formatDateDmy(proposal.proposedDate) : 'discussion'}
                    </button>
                  );
                })}
                {hiddenProposalThreads.length > 0 && <button type="button" className="mt-1 w-full px-2 py-1 text-left text-xs font-semibold text-text-muted underline" onClick={() => setShowHiddenProposalChats((current) => !current)}>{showHiddenProposalChats ? 'Hide old proposal chats' : `Show hidden chats (${hiddenProposalThreads.length})`}</button>}
              </section>
            );
          })}
          {!groupId && directContacts.length > 0 && (
            <section className="mb-4 last:mb-0">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Direct messages
              </h2>
              {directContacts.map((member) => {
                const existing = directThreads.find(
                  (thread) => threadCounterpart(thread, currentUserId) === member.id,
                );
                return (
                  <button
                    type="button"
                    key={member.id}
                    onClick={() => existing
                      ? setSelectedId(existing.id)
                      : void openDirect(member.id)}
                    className={`w-full rounded-sm px-2 py-2 text-left text-sm ${selected?.thread.id === existing?.id ? 'bg-highlight font-semibold' : 'hover:bg-surface'}`}
                  >
                    {member.isCurrentUser ? 'Notes to self' : (member.displayName || member.username)}
                  </button>
                );
              })}
            </section>
          )}
          {contexts.length === 0 && !error && (
            <p className="px-2 py-1 text-xs text-text-muted">No chats available.</p>
          )}
        </nav>

        <section className="min-w-0 rounded-md border border-border bg-surface-raised p-4" aria-labelledby="active-chat-title">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div><h2 id="active-chat-title" className="font-display text-lg">{selectedTitle}</h2>
            {!groupId && selected?.context && (
              <p className="text-xs text-text-muted">
                {selected.context.group.isSolo ? 'Just Me' : selected.context.group.name}
              </p>
            )}
            </div>
            {selected?.thread.kind === 'direct' && selectedMember?.username === 'unknown-member' && (
              <button type="button" className="text-xs font-semibold text-accent underline" onClick={() => void removeDirect(selected.thread.id)}>Remove deleted user chat</button>
            )}
          </div>
          {selected ? (
            <ChatPanel
              key={selected.thread.id}
              threadId={selected.thread.id}
              members={selected.context?.members ?? contacts}
            />
          ) : (
            <p className="text-sm text-text-muted">No chat selected.</p>
          )}
        </section>
      </div>
    </div>
  );
}
