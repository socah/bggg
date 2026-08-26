'use client';

import { useState } from 'react';
import type { Proposal } from '@/lib/types';
import type { ProposalActions } from '@/hooks/use-proposal-actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

interface ProposalLifecycleActionsProps {
  proposal: Proposal;
  canManage: boolean;
  actions: ProposalActions;
}

// Creator / owner-admin lifecycle controls, contextual to the current
// status. Undo from 'confirmed' also deletes the recorded play_sessions
// row server-side, so it gets the same confirmation dialog as cancel.
export function ProposalLifecycleActions({ proposal, canManage, actions }: ProposalLifecycleActionsProps) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const busy = actions.pendingAction !== null;

  if (!canManage || proposal.status === 'cancelled') return null;

  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      {proposal.status === 'collecting' && (
        <>
          <Button
            type="button"
            disabled={busy}
            onClick={() => actions.requestConfirmation(proposal.id)}
          >
            Request confirmation
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            Cancel proposal
          </Button>
        </>
      )}
      {proposal.status === 'confirming' && (
        <>
          <Button type="button" disabled={busy} onClick={() => actions.finalize(proposal.id)}>
            Finalize
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => actions.undo(proposal.id)}>
            Undo
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            Cancel proposal
          </Button>
        </>
      )}
      {proposal.status === 'confirmed' && (
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmingUndo(true)}>
            Undo confirmation
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingCancel(true)}>
            Cancel session
          </Button>
        </>
      )}

      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Cancel this proposal?</DialogTitle>
          <p className="mt-2 text-sm text-text-muted">
            Everyone will see it was cancelled. This cannot be undone — create a new proposal instead.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingCancel(false);
                void actions.cancel(proposal.id);
              }}
            >
              Yes, cancel it
            </Button>
            <DialogClose className="text-sm text-text-muted underline">Keep it</DialogClose>
          </div>
        </DialogSheetContent>
      </Dialog>

      <Dialog open={confirmingUndo} onOpenChange={setConfirmingUndo}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Undo this confirmed session?</DialogTitle>
          <p className="mt-2 text-sm text-text-muted">
            The recorded session is deleted and the proposal returns to collecting RSVPs.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirmingUndo(false);
                void actions.undo(proposal.id);
              }}
            >
              Undo it
            </Button>
            <DialogClose className="text-sm text-text-muted underline">Keep it</DialogClose>
          </div>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
