import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const apiFetch = jest.fn<(path: string) => Promise<Response>>();

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch, apiMutate: jest.fn() }));
jest.unstable_mockModule('@/components/chat-panel', () => ({
  ChatPanel: ({ threadId }: { threadId: string }) => <div>Chat {threadId}</div>,
}));

const { GroupChatView } = await import('./group-chat-view');

function response(payload: unknown): Response {
  return { ok: true, json: async () => payload } as Response;
}

describe('GroupChatView', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 9));
    apiFetch.mockImplementation(async (path) => {
      if (path === '/groups/group-1') return response({ id: 'group-1', name: 'Game Night', ownerId: 'user-1', isSolo: false, createdAt: '' });
      if (path === '/groups/group-1/chats') return response([
        { id: 'general', groupId: 'group-1', kind: 'general', proposalId: null, directUserA: null, directUserB: null, createdAt: '', updatedAt: '', lastMessage: null },
        { id: 'recent', groupId: 'group-1', kind: 'proposal', proposalId: 'proposal-recent', directUserA: null, directUserB: null, createdAt: '', updatedAt: '', lastMessage: null },
        { id: 'old', groupId: 'group-1', kind: 'proposal', proposalId: 'proposal-old', directUserA: null, directUserB: null, createdAt: '', updatedAt: '', lastMessage: null },
      ]);
      if (path === '/groups/group-1/members') return response([]);
      if (path === '/groups/group-1/proposals') return response([
        { id: 'proposal-recent', groupId: 'group-1', proposedDate: '2026-09-03', status: 'confirmed' },
        { id: 'proposal-old', groupId: 'group-1', proposedDate: '2026-09-01', status: 'confirmed' },
      ]);
      throw new Error(`Unexpected request: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('shows proposal chats in group mode and hides ones over a week old', async () => {
    render(<GroupChatView groupId="group-1" />);

    expect(await screen.findByRole('button', { name: 'Proposal: 03/09/2026' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Proposal: 01/09/2026' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show hidden chats (1)' }));
    expect(screen.getByRole('button', { name: 'Proposal: 01/09/2026' })).toBeTruthy();
  });
});
