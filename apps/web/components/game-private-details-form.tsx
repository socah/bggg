'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import type { GamePrivateDetails } from '@/lib/types';

export function GamePrivateDetailsForm({ gameId, initialDetails }: { gameId: number; initialDetails?: GamePrivateDetails }) {
  const [comment, setComment] = useState(initialDetails?.comment ?? '');
  const [amountPaid, setAmountPaid] = useState(initialDetails?.amountPaid?.toFixed(2) ?? '');
  const [dateAcquired, setDateAcquired] = useState(initialDetails?.dateAcquired ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const payload = JSON.stringify({ comment: comment.trim() || null, amountPaid: amountPaid === '' ? null : Number(amountPaid), dateAcquired: dateAcquired || null });
  const latestPayload = useRef<string | null>(payload);
  const lastQueuedPayload = useRef(payload);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(false);

  const save = useCallback((nextPayload: string) => {
    if (nextPayload === lastQueuedPayload.current) return;
    lastQueuedPayload.current = nextPayload;
    // Serialize writes so a slower earlier request cannot overwrite newer edits.
    queue.current = queue.current.then(async () => {
      if (mounted.current) { setSaving(true); setSaved(false); setError(null); }
      try {
        const response = await apiFetch(`/bgg-account/games/${gameId}/private-details`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: nextPayload,
        });
        if (!response.ok) {
          const body = await response.json() as { message?: string | string[] };
          throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to save private details');
        }
        if (mounted.current && latestPayload.current === nextPayload) setSaved(true);
        window.dispatchEvent(new Event('collection-stats-changed'));
      } catch (reason: unknown) {
        if (mounted.current && latestPayload.current === nextPayload) setError(reason instanceof Error ? reason.message : 'Unable to save private details');
      } finally {
        if (mounted.current) setSaving(false);
      }
    });
  }, [gameId]);

  useEffect(() => {
    latestPayload.current = form.current?.checkValidity() ? payload : null;
    if (latestPayload.current === null) return;
    const timer = window.setTimeout(() => save(payload), 700);
    return () => window.clearTimeout(timer);
  }, [payload, save]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closing the panel should also persist edits made inside the debounce window.
      if (latestPayload.current !== null) save(latestPayload.current);
    };
  }, [save]);

  return <section className="rounded-md border border-border bg-surface p-3 sm:p-4" aria-labelledby="game-private-details-heading">
    <h3 id="game-private-details-heading" className="font-display text-lg">Private details</h3>
    <p className="mt-1 text-xs text-text-muted">Only you can see your comment, purchase price and date acquired.</p>
    <form ref={form} onSubmit={(event) => event.preventDefault()} className="mt-3 flex flex-col gap-3">
      <label className="text-xs font-semibold text-text-muted">Private comment
        <textarea value={comment} maxLength={5000} onChange={(event) => { setComment(event.target.value); setSaved(false); }} rows={3} className="mt-1 block w-full rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised p-2 text-sm text-text" placeholder="Add a note just for you" />
      </label>
      <label className="max-w-64 text-xs font-semibold text-text-muted">Amount paid (EUR)
        <Input type="number" min="0" max="9999999999.99" step="0.01" value={amountPaid} onChange={(event) => { setAmountPaid(event.target.value); setSaved(false); }} className="mt-1 min-h-10 w-full" placeholder="Not recorded" />
      </label>
      <label className="max-w-64 text-xs font-semibold text-text-muted">Date acquired
        <Input type="date" value={dateAcquired} onChange={(event) => { setDateAcquired(event.target.value); setSaved(false); }} className="mt-1 min-h-10 w-full" />
      </label>
      <span role="status" className="text-xs text-text-muted">{saving ? 'Saving private details...' : saved ? 'Private details saved' : 'Changes save automatically'}</span>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
    </form>
  </section>;
}
