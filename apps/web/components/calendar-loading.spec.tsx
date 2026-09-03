import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/hooks/use-proposals', () => ({
  useAggregateProposals: () => ({
    proposals: [],
    loading: true,
    error: null,
    retry: jest.fn(),
  }),
  useGroupProposals: () => ({
    proposals: [],
    loading: true,
    error: null,
    retry: jest.fn(),
  }),
}));

jest.unstable_mockModule('@/hooks/use-groups', () => ({
  useGroups: () => ({ groups: [] }),
}));

jest.unstable_mockModule('@/components/calendar-month-grid', () => ({
  CalendarMonthGrid: () => <div data-testid="calendar-month-grid" />,
}));

const { default: PersonalCalendarPage } = await import('@/app/(shell)/calendar/page');
const { GroupCalendarView } = await import('./group-calendar-view');

describe('calendar loading states', () => {
  it('replaces the personal calendar with an accessible skeleton while loading', () => {
    render(<PersonalCalendarPage />);

    expect(screen.getByRole('status', { name: 'Loading your schedule' })).toBeTruthy();
    expect(screen.queryByTestId('calendar-month-grid')).toBeNull();
    expect(screen.queryByText('Loading your schedule…')).toBeNull();
  });

  it('replaces the group calendar with an accessible skeleton while loading', () => {
    render(<GroupCalendarView groupId="group-1" />);

    expect(screen.getByRole('status', { name: "Loading this group's schedule" })).toBeTruthy();
    expect(screen.queryByTestId('calendar-month-grid')).toBeNull();
    expect(screen.queryByText("Loading this group's schedule…")).toBeNull();
  });
});
