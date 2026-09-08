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
  soleAttendee?: boolean;
}

// Creator / owner-admin lifecycle controls, contextual to the current
// status. Undo from 'confirmed' also deletes the recorded play_sessions row.
export function ProposalLifecycleActions({ proposal, canManage, actions, soleAttendee = false }: ProposalLifecycleActionsProps) {
  const [confirmingUndo, setConfirmingUndo] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const busy = actions.pendingAction !== null;

  if (!canManage) return null;

  return (
    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
      {proposal.status === 'collecting' && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => actions.requestConfirmation(proposal.id)}
        >
          {soleAttendee ? 'Confirm proposal' : 'Request confirmation'}
        </Button>
      )}
      {proposal.status === 'confirming' && (
        <>
          <Button type="button" disabled={busy} onClick={() => actions.finalize(proposal.id)}>
            Finalize
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => actions.undo(proposal.id)}>
            Undo
          </Button>
        </>
      )}
      {proposal.status === 'confirmed' && (
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirmingUndo(true)}>
            Undo confirmation
          </Button>
        </>
      )}
      <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirmingDelete(true)}>
        Remove proposal
      </Button>

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

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Remove this proposal?</DialogTitle>
          <p className="mt-2 text-sm text-text-muted">
            This permanently removes the proposal and cannot be undone.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingDelete(false);
                void actions.delete(proposal.id);
              }}
            >
              Remove proposal
            </Button>
            <DialogClose className="text-sm text-text-muted underline">Keep proposal</DialogClose>
          </div>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
