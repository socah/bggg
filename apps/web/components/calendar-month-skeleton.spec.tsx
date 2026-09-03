import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import { CalendarMonthSkeleton } from './calendar-month-skeleton';

describe('CalendarMonthSkeleton', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the same number of week rows as the current month', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2021, 1, 1));

    const { container } = render(<CalendarMonthSkeleton label="Loading schedule" />);

    expect(container.querySelectorAll('[data-calendar-week]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-calendar-day]')).toHaveLength(28);
  });
});
