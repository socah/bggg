import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const apiFetch = jest.fn<typeof fetch>();

jest.unstable_mockModule('@/lib/api', () => ({ apiFetch }));

jest.unstable_mockModule('@/components/inline-proposal-panel', () => ({
  InlineProposalPanel: ({ proposalId, draftDate }: { proposalId: string | null; draftDate?: string }) => proposalId ? <div>Existing proposal</div> : <div>Proposal draft {draftDate}</div>,
}));

jest.unstable_mockModule('@/components/calendar-play-launcher', () => ({
  CalendarPlayLauncher: ({ date }: { date: string }) => <button type="button">Log play {date}</button>,
}));

jest.unstable_mockModule('@/components/play-log-dialog', () => ({
  PlayLogDialog: ({ editPlayId, inline }: { editPlayId?: string; inline?: boolean }) => <div>{inline ? 'Inline' : 'Modal'} logged play {editPlayId}</div>,
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

  it('keeps the play action below the selected date while collapsing', () => {
    render(<CalendarMonthGrid proposals={[]} />);
    const day = screen.getByRole('button', { name: 'May 1, 2026' });
    fireEvent.click(day);
    const launcherColumn = screen.getByRole('button', { name: 'Log play 2026-05-01' }).parentElement!;
    expect(launcherColumn.style.gridColumnStart).toBe('5');

    fireEvent.click(day);
    expect(launcherColumn.style.gridColumnStart).toBe('5');
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
    expect(screen.getByText('Inline logged play play-1')).toBeTruthy();
  });
});
