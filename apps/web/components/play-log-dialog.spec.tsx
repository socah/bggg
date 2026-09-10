import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn<typeof fetch>();

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
jest.unstable_mockModule('@/hooks/use-groups', () => ({
  useGroups: () => ({ groups: [{ id: 'group-1', name: 'Thursday Games', isSolo: false }] }),
}));
jest.unstable_mockModule('@/components/user-identity-link', () => ({
  UserIdentityLink: ({ user }: { user: { username: string } }) => <span>{user.username}</span>,
}));

const { PlayLogDialog } = await import('./play-log-dialog');

const roster = {
  members: [{ id: 'user-1', username: 'alice', displayName: 'Alice', isCurrentUser: true }],
  guests: [{ id: 'guest-1', groupId: 'group-1', name: 'Bob', linkedUserId: null }],
  canManageGuests: true,
  sessionId: 'session-1',
  sessionPlayerIds: ['user:user-1', 'guest:guest-1'],
};

describe('PlayLogDialog', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/play-players')) return { ok: true, json: async () => roster } as Response;
      if (url.endsWith('/plays') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'play-2', sessionId: 'session-1' }) } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(cleanup);

  it('defaults to every existing session participant and submits the existing session id', async () => {
    render(<PlayLogDialog
      inline
      game={{ id: 42, name: 'Azul' } as never}
      open
      defaults={{ groupId: 'group-1', playedDate: '2026-09-10', userIds: [] }}
      onOpenChange={jest.fn()}
    />);

    expect(await screen.findByText('Bob (guest)')).not.toBeNull();
    expect(screen.getByText('alice')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Minimize' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Log play' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [, init] = apiFetch.mock.calls[1];
    const payload = JSON.parse(String(init?.body));
    expect(payload.sessionId).toBe('session-1');
    expect(payload.players).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ guestPlayerId: 'guest-1' }),
    ]));
  });
});
