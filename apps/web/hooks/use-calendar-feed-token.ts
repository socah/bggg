'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/api';

interface CalendarFeedTokenState {
  feedUrl: string | null;
  pending: boolean;
  error: string | null;
  generate: () => Promise<void>;
}

// The raw feed URL exists only in this component's memory (and wherever
// the user pastes it) — POST /calendar/token stores only the hash, so
// there is deliberately no "fetch my existing URL" call. Generating again
// invalidates the previous URL; that replacement is the whole regeneration
// story.
export function useCalendarFeedToken(): CalendarFeedTokenState {
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setPending(true);
    setError(null);
    try {
      const response = await apiMutate('/calendar/token', 'POST');
      const data = (await response.json()) as { feedUrl: string };
      setFeedUrl(data.feedUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the feed URL');
    } finally {
      setPending(false);
    }
  }

  return { feedUrl, pending, error, generate };
}
