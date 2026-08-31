'use client';

import { useState } from 'react';
import type { Proposal, Rsvp } from '@/lib/types';
import type { ProposalActions } from '@/hooks/use-proposal-actions';
import { hhmm, formatWindowRange } from '@/lib/datetime';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TimePickerDialog } from '@/components/ui/time-picker-dialog';

interface ProposalRsvpSectionProps {
  proposalId: string;
  proposalStatus: Proposal['status'];
  myRsvp: Rsvp | undefined;
  actions: ProposalActions;
}

const ANSWERS = ['yes', 'maybe', 'no'] as const;

// Member-facing answer controls. Collecting: three one-click answers
// (empty window = server-side Decision G default). An optional disclosure
// lets people pin exact hours instead. Confirming: answers are closed —
// yes/maybe holders see the stored window and a lock-in toggle instead.
export function ProposalRsvpSection({ proposalId, proposalStatus, myRsvp, actions }: ProposalRsvpSectionProps) {
  const busy = actions.pendingAction !== null;
  const [hoursOpen, setHoursOpen] = useState(false);
  const [startInput, setStartInput] = useState('');
  const [endInput, setEndInput] = useState('');
  const [timePickerTarget, setTimePickerTarget] = useState<'start' | 'end' | null>(null);

  // Pre-fill the hour fields from the saved RSVP whenever it changes —
  // adjusted during render (guarded by the previous value) rather than in
  // an effect, so there's no cascading render.
  const [prevRsvp, setPrevRsvp] = useState(myRsvp);
  if (prevRsvp !== myRsvp) {
    setPrevRsvp(myRsvp);
    setStartInput(myRsvp?.availableStart ? hhmm(myRsvp.availableStart) : '');
    setEndInput(myRsvp?.availableEnd ? hhmm(myRsvp.availableEnd) : '');
  }

  if (proposalStatus === 'cancelled') return null;

  if (proposalStatus === 'confirming' || proposalStatus === 'confirmed') {
    const window = formatWindowRange(myRsvp?.availableStart ?? null, myRsvp?.availableEnd ?? null);
    return (
      <div>
        <div className="font-medium">Your answer</div>
        <p className="mt-1 text-text-muted">
          {myRsvp ? (
            <>
              {myRsvp.status.toUpperCase()}
              {window && <> — {window}</>}
              {myRsvp.confirmed && (
                <Badge className="ml-2">Locked in</Badge>
              )}
            </>
          ) : (
            'You did not answer'
          )}
        </p>
        {proposalStatus === 'confirming' && myRsvp && myRsvp.status !== 'no' && (
          <Button
            type="button"
            variant="secondary"
            className="mt-2"
            disabled={busy}
            onClick={() => void actions.lockIn(proposalId, !myRsvp.confirmed)}
          >
            {myRsvp.confirmed ? 'Withdraw lock-in' : 'Lock in'}
          </Button>
        )}
      </div>
    );
  }

  // status === 'collecting'
  async function saveHours(nextStatus: Rsvp['status']) {
    // Both filled → explicit hours; both cleared → back to the default
    // window (fields omitted). Mixed input is refused client-side because
    // the API treats each field independently.
    if (!!startInput !== !!endInput) return;
    await actions.rsvp(proposalId, {
      status: nextStatus,
      ...(startInput && endInput ? { availableStart: startInput, availableEnd: endInput } : {}),
    });
    setHoursOpen(false);
  }

  return (
    <div>
      <div className="font-medium">Your answer</div>
      <div className="mt-2 flex gap-2">
        {ANSWERS.map((answer) => (
          <Button
            key={answer}
            type="button"
            variant={myRsvp?.status === answer ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => void actions.rsvp(proposalId, { status: answer })}
          >
            {answer[0].toUpperCase() + answer.slice(1)}
          </Button>
        ))}
      </div>

      {(myRsvp?.status ?? 'yes') !== 'no' && (
        <div className="mt-2">
          <button
            type="button"
            className="text-xs text-text-muted underline"
            onClick={() => setHoursOpen((open) => !open)}
          >
            {hoursOpen ? 'Hide hours' : 'Specify hours'}
          </button>
          {hoursOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => setTimePickerTarget('start')}
                className="rounded border border-border bg-surface px-2 py-1 text-xs hover:border-text-muted"
                aria-label="Available from"
              >
                {startInput || 'Start time'}
              </button>
              <span>–</span>
              <button
                type="button"
                onClick={() => setTimePickerTarget('end')}
                className="rounded border border-border bg-surface px-2 py-1 text-xs hover:border-text-muted"
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
                  className="text-xs text-text-muted underline"
                >
                  Clear
                </button>
              )}
              <Button
                type="button"
                variant="secondary"
                disabled={
                  busy ||
                  (!!startInput !== !!endInput) ||
                  (!startInput && !endInput &&
                    !myRsvp?.availableStart && !myRsvp?.availableEnd)
                }
                onClick={() => void saveHours(myRsvp?.status ?? 'yes')}
              >
                Save hours
              </Button>
              {!myRsvp && <span className="text-xs text-text-muted">(saves your answer as Yes)</span>}
              <span className="text-xs text-text-muted">(times in UTC)</span>

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
          )}
        </div>
      )}
    </div>
  );
}
