'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/api';
import type { Group, Proposal } from '@/lib/types';
import { Button } from '@/components/ui/button';

interface CreateProposalInlineFormProps {
  date: string;
  groups: Group[];
  /** Fixed to the calendar's group when creating from a group schedule. */
  defaultGroupId?: string;
  onCreated: (proposal: Proposal) => void;
  onCancel: () => void;
}

// This stays entirely local until Save: selecting a calendar date must never
// create a proposal by itself.
export function CreateProposalInlineForm({
  date,
  groups,
  defaultGroupId,
  onCreated,
  onCancel,
}: CreateProposalInlineFormProps) {
  const [groupId, setGroupId] = useState(defaultGroupId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupId) return;

    setPending(true);
    setError(null);
    try {
      const response = await apiMutate(`/groups/${groupId}/proposals`, 'POST', { proposedDate: date });
      onCreated((await response.json()) as Proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the proposal');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 font-body text-sm">
      <div>
        <h3 className="font-display text-base">New proposal</h3>
        <p className="text-text-muted">
          Date: <time dateTime={date}>{date}</time>
        </p>
      </div>

      {!defaultGroupId && (
        <label className="flex flex-col gap-1">
          Group
          <select
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            disabled={pending || groups.length === 0}
            className="rounded-sm border border-border bg-surface px-2 py-1"
          >
            <option value="" disabled>
              Select a group
            </option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.isSolo ? `${group.name} (solo)` : group.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {!defaultGroupId && groups.length === 0 && (
        <p className="text-text-muted">You need a group before you can create a proposal.</p>
      )}

      {error && (
        <p role="alert" className="text-accent">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !groupId}>
          {pending ? 'Saving…' : 'Save proposal'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="self-center text-sm text-text-muted underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
