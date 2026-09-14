import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = jest.fn<typeof fetch>();

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));
jest.unstable_mockModule('@/hooks/use-groups', () => ({
  useGroups: () => ({ groups: [
    { id: 'solo-group', name: 'Just me', isSolo: true },
    { id: 'group-1', name: 'Thursday Games', isSolo: false },
  ] }),
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

  it('requires an explicit group choice when opened from Personal mode', async () => {
    render(<PlayLogDialog inline game={{ id: 42, name: 'Azul' } as never} open onOpenChange={jest.fn()} />);

    const group = screen.getByRole('combobox', { name: 'Group' }) as HTMLSelectElement;
    expect(group.value).toBe('');
    expect(screen.getByRole('option', { name: 'Choose a group' })).toBeTruthy();
    expect(screen.queryByLabelText('Date')).toBeNull();
    expect(screen.queryByText('Players')).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();

    fireEvent.change(group, { target: { value: 'group-1' } });

    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) => path === '/groups/group-1/plays' && init?.method === 'POST')).toBe(true));
  });

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
    expect(apiFetch.mock.calls[1][0]).toBe('/groups/group-1/plays');
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
      if (url.endsWith('/plays/play-1') && !init?.method) return { ok: true, json: async () => ({ status: 'finished', durationMinutes: null, notes: [{ id: 'user-1', userId: 'user-1', notes: 'Old note', username: 'alice', displayName: 'Alice', nickname: null, isCurrentUser: true }], players: [{ userId: 'user-1', guestPlayerId: null, isWinner: false, score: null }] }) } as Response;
      if (url.endsWith('/uploads/plays/play-1')) return { ok: true, json: async () => [] } as Response;
      if (url.endsWith('/plays/play-1/note') && init?.method === 'PATCH') return { ok: true, json: async () => ({ userId: 'user-1', notes: 'Updated note' }) } as Response;
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

    await waitFor(() => expect(apiFetch.mock.calls.some(([path, init]) => String(path).endsWith('/plays/play-1/note') && init?.method === 'PATCH')).toBe(true));
    const patchCall = apiFetch.mock.calls.find(([path, init]) => String(path).endsWith('/plays/play-1/note') && init?.method === 'PATCH');
    expect(JSON.parse(String(patchCall?.[1]?.body)).notes).toBe('Updated note');
    expect(JSON.parse(String(patchCall?.[1]?.body)).players).toBeUndefined();
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

    resolvePlay({ ok: true, json: async () => ({ status: 'finished', durationMinutes: null, notes: [], players: [
      { userId: 'user-1', guestPlayerId: null, isWinner: false, score: null },
      { userId: null, guestPlayerId: 'guest-1', isWinner: false, score: null },
    ] }) } as Response);

    expect(await screen.findByLabelText('alice score')).toBeTruthy();
    expect(screen.getByLabelText('Bob (guest) score')).toBeTruthy();
  });

  it('ignores an earlier player response after the editor is reopened', async () => {
    const playResolvers: Array<(response: Response) => void> = [];
    apiFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/play-players')) return { ok: true, json: async () => roster } as Response;
      if (url.endsWith('/plays/play-1')) {
        return new Promise<Response>((resolve) => { playResolvers.push(resolve); });
      }
      if (url.endsWith('/uploads/plays/play-1')) return { ok: true, json: async () => [] } as Response;
      throw new Error(`Unexpected request: ${url}`);
    });
    const props = {
      inline: true,
      game: { id: 42, name: 'Azul' } as never,
      editPlayId: 'play-1',
      defaults: { groupId: 'group-1', playedDate: '2026-09-10', userIds: [] },
      onOpenChange: jest.fn(),
    };
    const { rerender } = render(<PlayLogDialog {...props} open />);
    await waitFor(() => expect(playResolvers.length).toBeGreaterThan(0));
    const initialRequestCount = playResolvers.length;

    rerender(<PlayLogDialog {...props} open={false} />);
    rerender(<PlayLogDialog {...props} open />);
    await waitFor(() => expect(playResolvers.length).toBeGreaterThan(initialRequestCount));
    for (const resolve of playResolvers.slice(initialRequestCount)) {
      resolve({ ok: true, json: async () => ({ status: 'finished', durationMinutes: null, notes: [], players: [
        { userId: 'user-1', guestPlayerId: null, isWinner: false, score: null },
        { userId: null, guestPlayerId: 'guest-1', isWinner: false, score: null },
      ] }) } as Response);
    }
    expect(await screen.findByLabelText('Bob (guest) score')).toBeTruthy();

    for (const resolve of playResolvers.slice(0, initialRequestCount)) {
      resolve({ ok: true, json: async () => ({ status: 'finished', durationMinutes: null, notes: [], players: [
        { userId: 'user-1', guestPlayerId: null, isWinner: false, score: null },
      ] }) } as Response);
    }
    await waitFor(() => expect(screen.getByLabelText('Bob (guest) score')).toBeTruthy());
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

  it('shows non-player note authors as ghosts and removes the list with the last note', async () => {
    apiFetch.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/play-players')) return { ok: true, json: async () => roster } as Response;
      if (url.endsWith('/plays/play-1') && !init?.method) return { ok: true, json: async () => ({
        status: 'finished',
        durationMinutes: null,
        notes: [{ id: 'user-1', userId: 'user-1', notes: 'I watched this one', username: 'alice', displayName: 'Alice', nickname: null, isCurrentUser: true }],
        players: [{ userId: null, guestPlayerId: 'guest-1', isWinner: false, score: null }],
      }) } as Response;
      if (url.endsWith('/uploads/plays/play-1')) return { ok: true, json: async () => [] } as Response;
      if (url.endsWith('/plays/play-1/note') && init?.method === 'PATCH') return { ok: true, json: async () => ({ userId: 'user-1', notes: null }) } as Response;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<PlayLogDialog inline game={{ id: 42, name: 'Azul' } as never} open editPlayId="play-1" defaults={{ groupId: 'group-1', playedDate: '2026-09-10', userIds: [] }} onOpenChange={jest.fn()} />);

    expect(await screen.findByText('Ghosts')).toBeTruthy();
    const note = screen.getByLabelText('Alice ghost note');
    fireEvent.change(note, { target: { value: '' } });
    fireEvent.blur(note);

    await waitFor(() => expect(screen.queryByText('Ghosts')).toBeNull());
    expect(screen.getByLabelText('Your note')).toBeTruthy();
  });
});
