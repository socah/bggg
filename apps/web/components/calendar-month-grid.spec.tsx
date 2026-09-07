import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

jest.unstable_mockModule('@/components/inline-proposal-panel', () => ({
  InlineProposalPanel: () => null,
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
    expect(day.className).toContain('justify-start');
    expect(day.getAttribute('aria-pressed')).toBe('false');
    expect(day.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(day);

    expect(day.getAttribute('aria-pressed')).toBe('true');
    expect(day.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    ['collecting', 'Collecting RSVPs'],
    ['confirming', 'Awaiting confirmation'],
    ['confirmed', 'Confirmed session'],
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
    expect(within(screen.getByRole('button', { name: 'May 2, 2026' })).getByText('2').className).toContain('text-accent');
    expect(within(screen.getByRole('button', { name: 'May 3, 2026' })).getByText('3').className).toContain('text-accent');
  });
});
