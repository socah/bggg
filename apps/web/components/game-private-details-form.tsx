'use client';

import { FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import type { GamePrivateDetails } from '@/lib/types';

export function GamePrivateDetailsForm({ gameId, initialDetails }: { gameId: number; initialDetails?: GamePrivateDetails }) {
  const [comment, setComment] = useState(initialDetails?.comment ?? '');
  const [amountPaid, setAmountPaid] = useState(initialDetails?.amountPaid?.toFixed(2) ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await apiFetch(`/bgg-account/games/${gameId}/private-details`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim() || null, amountPaid: amountPaid === '' ? null : Number(amountPaid) }),
      });
      if (!response.ok) {
        const body = await response.json() as { message?: string | string[] };
        throw new Error(Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Unable to save private details');
      }
      setSaved(true);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to save private details');
    } finally {
      setSaving(false);
    }
  }

  return <section className="rounded-md border border-border bg-surface p-3 sm:p-4" aria-labelledby="game-private-details-heading">
    <h3 id="game-private-details-heading" className="font-display text-lg">Private details</h3>
    <p className="mt-1 text-xs text-text-muted">Only you can see your comment and purchase price.</p>
    <form onSubmit={(event) => void save(event)} className="mt-3 flex flex-col gap-3">
      <label className="text-xs font-semibold text-text-muted">Private comment
        <textarea value={comment} maxLength={5000} disabled={saving} onChange={(event) => { setComment(event.target.value); setSaved(false); }} rows={3} className="mt-1 block w-full rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised p-2 text-sm text-text" placeholder="Add a note just for you" />
      </label>
      <label className="max-w-64 text-xs font-semibold text-text-muted">Amount paid (EUR)
        <Input type="number" min="0" max="9999999999.99" step="0.01" value={amountPaid} disabled={saving} onChange={(event) => { setAmountPaid(event.target.value); setSaved(false); }} className="mt-1 min-h-10 w-full" placeholder="Not recorded" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" disabled={saving}>{saving ? 'Saving...' : 'Save private details'}</Button>
        {saved && <span role="status" className="text-xs text-text-muted">Private details saved</span>}
      </div>
      {error && <p role="alert" className="text-sm text-accent">{error}</p>}
    </form>
  </section>;
}
