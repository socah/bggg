import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const apiFetch = jest.fn<typeof fetch>();

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));

jest.unstable_mockModule('@/components/inline-proposal-panel', () => ({
  InlineProposalPanel: ({ proposalId, draftDate }: { proposalId: string | null; draftDate?: string }) => proposalId ? <div>Existing proposal</div> : <div>Proposal draft {draftDate}</div>,
}));

jest.unstable_mockModule('@/components/calendar-play-launcher', () => ({
  CalendarPlayLauncher: ({ date, onSelectGame }: { date: string; onSelectGame?: (game: never, groupId: string) => void }) => <button type="button" onClick={() => onSelectGame?.({ id: 42, name: 'Azul' } as never, 'group-1')}>Log play {date}</button>,
}));

jest.unstable_mockModule('@/components/play-log-dialog', () => ({
  PlayLogDialog: ({ editPlayId, inline, defaults, onCreated }: { editPlayId?: string; inline?: boolean; defaults?: { groupId: string }; onCreated?: (playId: string) => void }) => <div data-group-id={defaults?.groupId}><span>{inline ? 'Inline' : 'Modal'} logged play {editPlayId}</span>{onCreated && <button type="button" onClick={() => onCreated('play-new')}>Complete play creation</button>}</div>,
}));

jest.unstable_mockModule('@/components/session-place-control', () => ({
  SessionPlaceControl: () => <div>Session place</div>,
}));

const { CalendarMonthGrid } = await import('./calendar-month-grid');

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    void callback;
  }

  observe(target: Element, options?: ResizeObserverOptions) {
    void target;
    void options;
  }

  unobserve(target: Element) {
    void target;
  }

  disconnect() {}
}

describe('CalendarMonthGrid', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 4, 1));
    global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
    apiFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('exposes a proposed day as a named button with selected and expanded state', () => {
    render(
      <CalendarMonthGrid
        proposals={[{
          id: 'proposal-1',
          groupId: 'group-1',
          createdBy: 'user-1',
          proposedDate: '2026-05-15',
          hostId: null,
          status: 'collecting',
          confirmedStart: null,
          confirmedEnd: null,
          createdAt: '2026-04-01T00:00:00.000Z',
        }]}
      />
    );

    const day = screen.getByRole('button', { name: 'May 15, 2026, 1 proposal' });
    expect(day.parentElement?.className).toContain('justify-start');
    expect(day.getAttribute('aria-pressed')).toBe('false');
    expect(day.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(day);

    expect(day.getAttribute('aria-pressed')).toBe('true');
    expect(day.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    ['collecting', 'RSVP'],
    ['confirming', 'Confirming'],
    ['confirmed', 'Set'],
  ] as const)('labels a %s proposal with its lifecycle stage', (status, label) => {
    render(
      <CalendarMonthGrid proposals={[{
        id: `proposal-${status}`,
        groupId: 'group-1',
        createdBy: 'user-1',
        proposedDate: '2026-05-15',
        hostId: null,
        status,
        confirmedStart: null,
        confirmedEnd: null,
        createdAt: '2026-04-01T00:00:00.000Z',
      }]} />,
    );

    expect(screen.getByText(label)).toBeTruthy();
  });

  it('distinguishes Saturday and Sunday headings and date numbers', () => {
    render(<CalendarMonthGrid proposals={[]} />);

    const weekendHeadings = screen.getAllByText('S');
    expect(weekendHeadings[0].className).toContain('text-accent');
    expect(weekendHeadings[1].className).toContain('text-accent');
    expect(within(screen.getByRole('button', { name: 'May 2, 2026' }).parentElement!).getByText('2').className).toContain('text-accent');
    expect(within(screen.getByRole('button', { name: 'May 3, 2026' }).parentElement!).getByText('3').className).toContain('text-accent');
  });

  it('offers only play logging before today', () => {
    render(<CalendarMonthGrid proposals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'April 30, 2026' }));
    expect(screen.getByRole('button', { name: 'Log play 2026-04-30' })).toBeTruthy();
    expect(screen.queryByText('Proposal draft 2026-04-30')).toBeNull();
  });

  it('offers proposal creation and play logging today', () => {
    render(<CalendarMonthGrid proposals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'May 1, 2026' }));
    expect(screen.getByText('Proposal draft 2026-05-01')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log play 2026-05-01' })).toBeTruthy();
  });

  it('expands the play action inside the selected date cell', () => {
    render(<CalendarMonthGrid proposals={[]} />);
    const day = screen.getByRole('button', { name: 'May 1, 2026' });
    fireEvent.click(day);
    const launcher = screen.getByRole('button', { name: 'Log play 2026-05-01' });
    expect(day.parentElement?.contains(launcher)).toBe(true);
    expect(launcher.parentElement?.className).toContain('opacity-100');

    fireEvent.click(day);
    expect(launcher.parentElement?.className).toContain('opacity-0');
  });

  it('does not add week-panel spacing for an empty past date', () => {
    render(<CalendarMonthGrid proposals={[]} />);
    const day = screen.getByRole('button', { name: 'April 30, 2026' });
    fireEvent.click(day);

    const week = day.parentElement?.parentElement?.parentElement;
    expect(week?.children[1]?.className).toContain('my-0');
  });

  it('uses the same spacing between week rows and date columns', () => {
    const { container } = render(<CalendarMonthGrid proposals={[]} />);
    const week = container.querySelector('.grid-cols-7.gap-x-1');
    expect(week?.parentElement?.parentElement?.className).toContain('gap-1');
  });

  it('marks and highlights today', () => {
    render(<CalendarMonthGrid proposals={[]} />);
    const today = screen.getByRole('button', { name: 'May 1, 2026' });
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.parentElement?.className).toContain('bg-highlight/20');
  });

  it('mounts a new play editor only in the currently expanded week', () => {
    jest.setSystemTime(new Date(2026, 4, 31));
    render(<CalendarMonthGrid proposals={[]} groups={[{ id: 'group-1', name: 'Thursday Games', ownerId: 'user-1', isSolo: false, createdAt: '' }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'May 1, 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'May 8, 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log play 2026-05-08' }));
    const editor = screen.getAllByText('Inline logged play');
    expect(editor.length).toBe(1);
    expect(editor[0].closest('[data-group-id]')?.getAttribute('data-group-id')).toBe('');
  });

  it('offers only proposal creation after today', () => {
    render(<CalendarMonthGrid proposals={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'May 2, 2026' }));
    expect(screen.getByText('Proposal draft 2026-05-02')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Log play 2026-05-02' })).toBeNull();
  });

  it('shows logged plays returned for the calendar group', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 'play-1',
        sessionId: 'session-1',
        proposalId: null,
        groupId: 'group-1',
        groupName: 'Thursday Games',
        game: { id: 1, bggId: 230802, name: 'Azul', image: null, thumbnail: null, minPlayers: 2, maxPlayers: 4, playingTime: 45, yearPublished: 2017, rating: 7.7 },
        playedDate: '2026-05-01',
        status: 'finished',
        durationMinutes: 45,
        notes: null,
        canEdit: true,
        sessionParticipants: [{ id: 'user:user-1', name: 'Alice' }, { id: 'guest:guest-1', name: 'Bob' }],
        playParticipants: [{ id: 'user:user-1', name: 'Alice', isWinner: true }, { id: 'guest:guest-1', name: 'Bob', isWinner: false }],
        sessionPlace: null,
      }],
    } as Response);

    render(<CalendarMonthGrid proposals={[]} groups={[{ id: 'group-1', name: 'Thursday Games', ownerId: 'user-1', isSolo: false, createdAt: '' }]} />);

    expect(await screen.findByRole('button', { name: 'Played Azul - Thursday Games' })).toBeTruthy();
    expect(screen.getByText('Logged')).toBeTruthy();
    expect(screen.getByTitle('Logged session - Thursday Games: Alice, Bob')).toBeTruthy();
    expect(screen.getByLabelText('Alice, Bob').parentElement?.className).toContain('hidden');
    expect(screen.getByTitle('Alice').getAttribute('style')).not.toBe(screen.getByTitle('Bob').getAttribute('style'));
    expect(apiFetch).toHaveBeenCalledWith('/groups/group-1/plays', { cache: 'no-store' });

    fireEvent.click(screen.getByRole('button', { name: 'Played Azul - Thursday Games' }));
    const playRow = screen.getByText('Azul details').closest('button')!;
    expect(within(within(playRow).getByTitle('Alice')).getByLabelText('Winner')).toBeTruthy();
    expect(within(within(playRow).getByTitle('Bob')).queryByLabelText('Winner')).toBeNull();
    expect(screen.getByText('Inline logged play play-1')).toBeTruthy();
  });

  it('allows a member to expand a play logged by somebody else', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 'play-member', sessionId: 'session-member', proposalId: null, groupId: 'group-member', groupName: 'Thursday Games',
        game: { id: 1, bggId: 230802, name: 'Azul', image: null, thumbnail: null, minPlayers: 2, maxPlayers: 4, playingTime: 45, yearPublished: 2017, rating: 7.7 },
        playedDate: '2026-05-01', status: 'finished', durationMinutes: null, notes: null, canEdit: false,
        sessionParticipants: [], playParticipants: [], sessionPlace: null,
      }],
    } as Response);
    render(<CalendarMonthGrid proposals={[]} groups={[{ id: 'group-member', name: 'Thursday Games', ownerId: 'owner-1', isSolo: false, createdAt: '' }]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Played Azul - Thursday Games' }));

    expect(screen.getByText('Inline logged play play-member')).toBeTruthy();
  });

  it('shows only each play participants when plays share a session', async () => {
    const basePlay = {
      sessionId: 'session-1',
      proposalId: null,
      groupId: 'group-1',
      groupName: 'Thursday Games',
      playedDate: '2026-05-01',
      status: 'finished' as const,
      durationMinutes: null,
      notes: null,
      canEdit: true,
      sessionParticipants: [
        { id: 'user:user-1', name: 'Alice' },
        { id: 'guest:guest-1', name: 'Bob' },
        { id: 'guest:guest-2', name: 'Carol' },
      ],
      sessionPlace: null,
    };
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { ...basePlay, id: 'play-1', game: { id: 1, name: 'Azul', image: null, thumbnail: null }, playParticipants: basePlay.sessionParticipants.slice(0, 2) },
        { ...basePlay, id: 'play-2', game: { id: 2, name: 'Cascadia', image: null, thumbnail: null }, playParticipants: [basePlay.sessionParticipants[0], basePlay.sessionParticipants[2]] },
      ],
    } as Response);

    render(<CalendarMonthGrid proposals={[]} groups={[{ id: 'group-1', name: 'Thursday Games', ownerId: 'user-1', isSolo: false, createdAt: '' }]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'May 1, 2026, 0 proposals, 2 logged plays' }));

    const azulRow = screen.getByText('Azul').closest('button')!;
    const cascadiaRow = screen.getByText('Cascadia').closest('button')!;
    expect(within(azulRow).getByLabelText('Alice, Bob')).toBeTruthy();
    expect(within(azulRow).queryByTitle('Carol')).toBeNull();
    expect(within(cascadiaRow).getByLabelText('Alice, Carol')).toBeTruthy();
    expect(within(cascadiaRow).queryByTitle('Bob')).toBeNull();
  });

  it('resolves avatar colour collisions within a participant list', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 'play-collision',
        sessionId: 'session-collision',
        proposalId: null,
        groupId: 'group-1',
        groupName: 'Thursday Games',
        game: { id: 1, name: 'Azul', image: null, thumbnail: null },
        playedDate: '2026-05-01',
        status: 'finished',
        durationMinutes: null,
        notes: null,
        canEdit: true,
        sessionParticipants: [],
        playParticipants: [{ id: 'user:Aa', name: 'Alex' }, { id: 'user:BB', name: 'Amy' }],
        sessionPlace: null,
      }],
    } as Response);

    render(<CalendarMonthGrid proposals={[]} groups={[{ id: 'group-1', name: 'Thursday Games', ownerId: 'user-1', isSolo: false, createdAt: '' }]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'May 1, 2026, 0 proposals, 1 logged play' }));

    const row = screen.getByText('Azul').closest('button')!;
    expect(within(row).getByTitle('Alex').textContent).toBe('A');
    expect(within(row).getByTitle('Amy').textContent).toBe('A');
    expect(within(row).getByTitle('Alex').getAttribute('style')).not.toBe(within(row).getByTitle('Amy').getAttribute('style'));
  });

  it.each([
    ['a selected group', 'group-panel-selected', 'group-panel-selected'],
    ['Personal mode', undefined, 'group-panel-personal'],
  ])('replaces the temporary editor with one expanded details panel in %s', async (_label, defaultGroupId, groupId) => {
    const play = {
      id: 'play-new', sessionId: 'session-1', proposalId: null, groupId, groupName: 'Thursday Games',
      game: { id: 42, name: 'Azul', image: null, thumbnail: null }, playedDate: '2026-05-01', status: 'finished' as const,
      durationMinutes: null, notes: null, canEdit: true, sessionParticipants: [], playParticipants: [], sessionPlace: null,
    };
    let requestCount = 0;
    apiFetch.mockImplementation(async () => ({ ok: true, json: async () => requestCount++ === 0 ? [] : [play] }) as Response);
    render(<CalendarMonthGrid proposals={[]} groups={[{ id: groupId, name: 'Thursday Games', ownerId: 'user-1', isSolo: false, createdAt: '' }]} defaultGroupId={defaultGroupId} />);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'May 1, 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log play 2026-05-01' }));

    fireEvent.click(screen.getByRole('button', { name: 'Complete play creation' }));

    expect(await screen.findByText('Azul details')).toBeTruthy();
    expect(screen.getByText('Inline logged play play-new')).toBeTruthy();
    expect(screen.queryByText('Inline logged play')).toBeNull();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  });
});
