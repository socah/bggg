'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/api';
import type { Group, Proposal } from '@/lib/types';
import { Button } from '@/components/ui/button';

export interface InlineCreateProposalProps {
  date: string;
  groups: Group[];
  defaultGroupId?: string;
  onCreated: (proposal: Proposal) => void;
  onCancel: () => void;
}

export function InlineCreateProposal({
  date,
  groups,
  defaultGroupId,
  onCreated,
  onCancel,
}: InlineCreateProposalProps) {
  const [groupId, setGroupId] = useState(defaultGroupId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveGroupId = defaultGroupId || groupId || groups[0]?.id || '';
  const currentGroup = groups.find((g) => g.id === effectiveGroupId);

  const formattedDate = (() => {
    try {
      const d = new Date(`${date}T00:00:00`);
      return d.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return date;
    }
  })();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveGroupId || !date) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiMutate(`/groups/${effectiveGroupId}/proposals`, 'POST', {
        proposedDate: date,
      });
      const created = (await response.json()) as Proposal;
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the proposal');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface-raised p-4 font-body text-sm shadow-sm transition-all">
      <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
        <h3 className="font-display text-base font-semibold">New Proposal</h3>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="h-6 w-6 p-0 text-text-muted hover:text-text"
          aria-label="Cancel proposal"
        >
          ✕
        </Button>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-3 max-w-md">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Date</span>
          <div className="font-display text-base font-medium mt-0.5">{formattedDate}</div>
        </div>

        {defaultGroupId ? (
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Group</span>
            <div className="mt-0.5 text-sm font-medium">
              {currentGroup ? (currentGroup.isSolo ? `${currentGroup.name} (solo)` : currentGroup.name) : 'Active group'}
            </div>
          </div>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Group</span>
            <select
              value={effectiveGroupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={pending || groups.length === 0}
              className="rounded border border-border bg-surface px-2 py-1 text-sm focus:outline-none"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.isSolo ? `${g.name} (solo)` : g.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {error && <p className="text-xs text-accent">{error}</p>}

        <div className="flex gap-2 mt-2">
          <Button type="submit" disabled={pending || !effectiveGroupId || !date}>
            {pending ? 'Saving…' : 'Save proposal'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
