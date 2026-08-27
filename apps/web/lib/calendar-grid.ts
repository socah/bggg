import type { Proposal } from './types';

export interface CalendarDay {
  date: Date;
  inMonth: boolean;
}

// Builds a full 7-column grid (Mon-Sun) for the month containing
// `monthAnchor`, including the leading/trailing days from adjacent months
// needed to fill complete weeks.
export function buildMonthGrid(monthAnchor: Date): CalendarDay[] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  // JS getDay(): 0=Sunday..6=Saturday. Rebased to Monday-first by folding
  // the weekend around: Sunday(0) becomes 6, Monday(1) stays 0.
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const days: CalendarDay[] = [];
  for (let i = 0; i < startWeekday; i++) {
    days.push({ date: new Date(year, month, i - startWeekday + 1), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ date: new Date(year, month, d), inMonth: true });
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1].date;
    days.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      inMonth: false,
    });
  }
  return days;
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function weekIndexForDate(grid: CalendarDay[], dateKey: string): number | null {
  const index = grid.findIndex(({ date }) => toDateKey(date) === dateKey);
  return index === -1 ? null : Math.floor(index / 7);
}

// The date a proposal is placed on — see the design spec's "Placement
// rule": confirmedStart's date once one exists, else proposedDate.
//
// proposedDate is a bare "YYYY-MM-DD" string with no time/zone component.
// `new Date('YYYY-MM-DD')` parses date-only ISO strings as UTC midnight —
// converting that back to local Y/M/D can roll it back a day in any
// negative-UTC-offset timezone. It's already in exactly the "YYYY-MM-DD"
// shape toDateKey produces, so it's used as-is instead of round-tripping
// through a Date object.
export function placementDateKey(proposal: Proposal): string {
  if (proposal.confirmedStart) {
    return toDateKey(new Date(proposal.confirmedStart));
  }
  return proposal.proposedDate;
}
