import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import { TimePickerDialog } from './time-picker-dialog';

describe('TimePickerDialog', () => {
  afterEach(cleanup);

  it('keeps an hour label above the selection circle with dark contrast text', () => {
    render(<TimePickerDialog open startValue="18:00" endValue="22:00" onOpenChange={jest.fn()} onConfirm={jest.fn()} />);

    const selectedHour = screen.getByText('6');
    expect(selectedHour.className).toContain('z-10');
    expect(selectedHour.className).toContain('text-black');
  });
});
