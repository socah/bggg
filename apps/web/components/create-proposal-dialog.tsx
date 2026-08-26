'use client';

import { useState } from 'react';
import { toDateKey } from '@/lib/calendar-grid';
import { apiMutate } from '@/lib/api';
import type { Group, Proposal } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

interface CreateProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: Group[];
  /** Preselected group (the page the button lives on); omit on aggregate pages. */
  defaultGroupId?: string;
  onCreated: (proposal: Proposal) => void;
}

// Propose a game night: pick a day (Decision G anchors everything else —
// windows, defaults — to this date) and optionally which group. The server
// creates the creator's implicit yes-RSVP, so nothing else is asked here.
export function CreateProposalDialog({ open, onOpenChange, groups, defaultGroupId, onCreated }: CreateProposalDialogProps) {
  const [groupId, setGroupId] = useState(defaultGroupId ?? '');
  const [date, setDate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveGroupId = groupId || groups[0]?.id || '';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveGroupId || !date) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiMutate(`/groups/${effectiveGroupId}/proposals`, 'POST', {
        proposedDate: date,
      });
      const created = (await response.json()) as Proposal;
      setDate('');
      onOpenChange(false);
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the proposal');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setError(null);
        onOpenChange(o);
      }}
    >
      <DialogSheetContent aria-describedby={undefined}>
        <DialogTitle>New proposal</DialogTitle>
        <DialogClose className="mb-3 mt-1 block text-sm text-text-muted">Close ✕</DialogClose>

        <form onSubmit={submit} className="flex flex-col gap-3 font-body text-sm">
          <label className="flex flex-col gap-1">
            Group
            <select
              value={effectiveGroupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={pending || groups.length === 0}
              className="rounded-sm border border-border bg-surface px-2 py-1"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.isSolo ? `${g.name} (solo)` : g.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            Date
            <input
              type="date"
              required
              min={toDateKey(new Date())}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className="rounded-sm border border-border bg-surface px-2 py-1"
            />
          </label>

          {error && <p className="text-accent">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !effectiveGroupId || !date}>
              {pending ? 'Creating…' : 'Create proposal'}
            </Button>
            <DialogClose className="self-center text-sm text-text-muted underline">Cancel</DialogClose>
          </div>
        </form>
      </DialogSheetContent>
    </Dialog>
  );
}
