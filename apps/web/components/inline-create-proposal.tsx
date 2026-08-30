'use client';

import { useState } from 'react';
import { apiMutate } from '@/lib/api';
import { useGroupLibrary } from '@/hooks/use-group-library';
import type { Group, Proposal } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { TimePickerDialog } from '@/components/ui/time-picker-dialog';

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
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [timePickerTarget, setTimePickerTarget] = useState<'start' | 'end' | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<number | ''>('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveGroupId = defaultGroupId || groupId || groups[0]?.id || '';
  const currentGroup = groups.find((g) => g.id === effectiveGroupId);

  const { games: libraryGames, loading: loadingGames } = useGroupLibrary(
    effectiveGroupId || null
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveGroupId || !date) return;
    if (!!startInput !== !!endInput) {
      setError('Please specify both start and end times, or clear both.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      // 1. Create proposal
      const response = await apiMutate(`/groups/${effectiveGroupId}/proposals`, 'POST', {
        proposedDate: date,
      });
      const created = (await response.json()) as Proposal;

      // 2. If hours are specified, update RSVP
      if (startInput && endInput) {
        await apiMutate(`/proposals/${created.id}/rsvp`, 'PUT', {
          status: 'yes',
          availableStart: startInput,
          availableEnd: endInput,
        });
      }

      // 3. If a game was selected, suggest it
      if (selectedGameId) {
        await apiMutate(`/proposals/${created.id}/games`, 'POST', {
          gameId: selectedGameId,
        });
      }

      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the proposal');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface-raised p-4 font-body text-sm shadow-sm transition-all relative">
      <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
        <div className="text-xs text-text-muted font-medium">
          {defaultGroupId ? (
            <span>Group: <strong className="text-text font-semibold">{currentGroup ? (currentGroup.isSolo ? `${currentGroup.name} (solo)` : currentGroup.name) : 'Active group'}</strong></span>
          ) : (
            <span>New proposal details</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          className="h-6 w-6 p-0 text-text-muted hover:text-text ml-auto"
          aria-label="Cancel"
        >
          ✕
        </Button>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-3 max-w-lg">
        {!defaultGroupId && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Group</span>
            <select
              value={effectiveGroupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setSelectedGameId('');
              }}
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

        {/* Specify Hours Section */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-1">
            Your Availability (Optional)
          </span>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setTimePickerTarget('start')}
              className="rounded border border-border bg-surface px-2.5 py-1.5 hover:border-text-muted text-xs"
              aria-label="Available from"
            >
              {startInput || 'Start time'}
            </button>
            <span>–</span>
            <button
              type="button"
              onClick={() => setTimePickerTarget('end')}
              className="rounded border border-border bg-surface px-2.5 py-1.5 hover:border-text-muted text-xs"
              aria-label="Available until"
            >
              {endInput || 'End time'}
            </button>
            {(startInput || endInput) && (
              <button
                type="button"
                onClick={() => {
                  setStartInput('');
                  setEndInput('');
                }}
                className="text-xs text-text-muted underline hover:text-text"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-text-muted ml-1">(times in UTC)</span>
          </div>
        </div>

        {/* Suggested Game Section */}
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted block mb-1">
            Suggest Game (Optional)
          </span>
          <select
            value={selectedGameId}
            onChange={(e) => setSelectedGameId(e.target.value ? Number(e.target.value) : '')}
            disabled={pending || loadingGames}
            className="w-full rounded border border-border bg-surface px-2 py-1 text-xs focus:outline-none"
          >
            <option value="">-- None --</option>
            {libraryGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.minPlayers}–{g.maxPlayers} players)
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-xs text-accent">{error}</p>}

        <div className="flex gap-2 mt-2 pt-2 border-t border-border">
          <Button type="submit" disabled={pending || !effectiveGroupId || !date}>
            {pending ? 'Saving…' : 'Save proposal'}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>

      <TimePickerDialog
        open={timePickerTarget !== null}
        value={timePickerTarget === 'start' ? startInput : endInput}
        title={timePickerTarget === 'start' ? 'Available from' : 'Available until'}
        onOpenChange={(open) => {
          if (!open) setTimePickerTarget(null);
        }}
        onConfirm={(selectedTime) => {
          if (timePickerTarget === 'start') {
            setStartInput(selectedTime);
          } else if (timePickerTarget === 'end') {
            setEndInput(selectedTime);
          }
          setTimePickerTarget(null);
        }}
      />
    </div>
  );
}
