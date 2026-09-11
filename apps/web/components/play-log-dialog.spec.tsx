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

  it('immediately creates a play with every existing session participant', async () => {
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

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    const [, init] = apiFetch.mock.calls[1];
    const payload = JSON.parse(String(init?.body));
    expect(payload.sessionId).toBe('session-1');
    expect(payload.players).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ guestPlayerId: 'guest-1' }),
    ]));
    expect(screen.queryByRole('button', { name: 'Log play' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Delete play' })).toBeTruthy();
  });

  it('saves edited text fields on blur without save or cancel buttons', async () => {
    apiFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/play-players')) return { ok: true, json: async () => roster } as Response;
      if (url.endsWith('/plays/play-1') && !init?.method) return { ok: true, json: async () => ({ status: 'finished', durationMinutes: null, notes: 'Old note', players: [{ userId: 'user-1', guestPlayerId: null, isWinner: false, score: null }] }) } as Response;
      if (url.endsWith('/uploads/plays/play-1')) return { ok: true, json: async () => [] } as Response;
      if (url.endsWith('/plays/play-1') && init?.method === 'PATCH') return { ok: true, json: async () => ({}) } as Response;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<PlayLogDialog
      inline
      game={{ id: 42, name: 'Azul' } as never}
      open
      editPlayId="play-1"
      defaults={{ groupId: 'group-1', playedDate: '2026-09-10', userIds: [] }}
      onOpenChange={jest.fn()}
    />);

    const notes = await screen.findByDisplayValue('Old note');
    fireEvent.change(notes, { target: { value: 'Updated note' } });
    fireEvent.blur(notes);

    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) => String(path).endsWith('/plays/play-1') && init?.method === 'PATCH')).toBe(true));
    const patchCall = apiFetch.mock.calls.find(([path, init]) => String(path).endsWith('/plays/play-1') && init?.method === 'PATCH');
    expect(JSON.parse(String(patchCall?.[1]?.body)).notes).toBe('Updated note');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('does not show only the current user while an edited play is loading', async () => {
    let resolvePlay!: (response: Response) => void;
    const playResponse = new Promise<Response>((resolve) => { resolvePlay = resolve; });
    apiFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/play-players')) return { ok: true, json: async () => roster } as Response;
      if (url.endsWith('/plays/play-1')) return playResponse;
      if (url.endsWith('/uploads/plays/play-1')) return { ok: true, json: async () => [] } as Response;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<PlayLogDialog inline game={{ id: 42, name: 'Azul' } as never} open editPlayId="play-1" defaults={{ groupId: 'group-1', playedDate: '2026-09-10', userIds: [] }} onOpenChange={jest.fn()} />);

    expect(await screen.findByText('Loading players...')).toBeTruthy();
    await waitFor(() => expect(apiFetch.mock.calls.some(([path]) => String(path).includes('/play-players'))).toBe(true));
    expect(screen.queryByLabelText('alice score')).toBeNull();
    expect(screen.queryByText('No players selected.')).toBeNull();
    expect(apiFetch.mock.calls.find(([path]) => String(path).endsWith('/plays/play-1'))?.[1]).toEqual({ cache: 'no-store' });

    resolvePlay({ ok: true, json: async () => ({ status: 'finished', durationMinutes: null, notes: null, players: [
      { userId: 'user-1', guestPlayerId: null, isWinner: false, score: null },
      { userId: null, guestPlayerId: 'guest-1', isWinner: false, score: null },
    ] }) } as Response);

    expect(await screen.findByLabelText('alice score')).toBeTruthy();
    expect(screen.getByLabelText('Bob (guest) score')).toBeTruthy();
  });

  it('allows a failed immediate creation to be retried', async () => {
    let attempts = 0;
    apiFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/play-players')) return { ok: true, json: async () => roster } as Response;
      if (url.endsWith('/plays') && init?.method === 'POST') {
        attempts += 1;
        if (attempts === 1) throw new Error('Network unavailable');
        return { ok: true, json: async () => ({ id: 'play-2', sessionId: 'session-1' }) } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<PlayLogDialog inline game={{ id: 42, name: 'Azul' } as never} open defaults={{ groupId: 'group-1', playedDate: '2026-09-10', userIds: [] }} onOpenChange={jest.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry creating play' }));
    expect(await screen.findByRole('button', { name: 'Delete play' })).toBeTruthy();
    expect(attempts).toBe(2);
  });
});
