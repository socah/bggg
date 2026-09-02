import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

jest.unstable_mockModule('@/hooks/use-calendar-feed-token', () => ({
  useCalendarFeedToken: () => ({
    feedUrl: 'https://example.com/calendar/feed.ics',
    pending: false,
    error: null,
    generate: async () => undefined,
  }),
}));

const { CalendarFeedSettings } = await import('./calendar-feed-settings');
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(writeText?: () => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

afterEach(() => {
  cleanup();
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('CalendarFeedSettings', () => {
  it('reports that the feed URL was copied', async () => {
    setClipboard(async () => undefined);

    render(<CalendarFeedSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect((await screen.findByRole('status')).textContent).toBe('Feed URL copied to clipboard.');
  });

  it('reports a rejected clipboard write so the URL can be copied manually', async () => {
    setClipboard(async () => {
      throw new Error('Permission denied');
    });

    render(<CalendarFeedSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy the feed URL. Copy it manually.');
  });

  it('reports when the clipboard API is unavailable', async () => {
    setClipboard();

    render(<CalendarFeedSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy the feed URL. Copy it manually.');
  });
});
