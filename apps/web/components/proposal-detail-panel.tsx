'use client';

import { useProposalDetail } from '@/hooks/use-proposal-detail';
import { useGroupMembers } from '@/hooks/use-group-members';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

interface ProposalDetailPanelProps {
  proposalId: string | null;
  onClose: () => void;
}

export function ProposalDetailPanel({ proposalId, onClose }: ProposalDetailPanelProps) {
  const { detail, loading, notFound, error, retry } = useProposalDetail(proposalId);
  const members = useGroupMembers(detail?.proposal.groupId ?? null);

  function nameFor(userId: string): string {
    return members.find((m) => m.id === userId)?.displayName ?? userId;
  }

  return (
    <Dialog open={proposalId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogSheetContent aria-describedby={undefined}>
        <DialogTitle className="sr-only">Proposal details</DialogTitle>
        <DialogClose className="mb-2 text-sm text-text-muted">Close ✕</DialogClose>

        {loading && <p>Loading…</p>}
        {notFound && <p>This item is no longer available.</p>}
        {error && (
          <p className="text-accent">
            {error}{' '}
            <button type="button" onClick={retry} className="underline">
              Retry
            </button>
          </p>
        )}

        {detail && (
          <div className="space-y-3 font-body text-sm">
            <div>
              <div className="font-display text-base">{detail.proposal.proposedDate}</div>
              <div className="text-text-muted">Status: {detail.proposal.status}</div>
              <div className="text-text-muted">Proposed by: {nameFor(detail.proposal.createdBy)}</div>
              {detail.proposal.hostId && (
                <div className="text-text-muted">Host: {nameFor(detail.proposal.hostId)}</div>
              )}
            </div>

            <div>
              <div className="font-medium">RSVPs</div>
              <ul>
                {detail.rsvps.map((rsvp) => (
                  <li key={rsvp.userId}>
                    {nameFor(rsvp.userId)} — {rsvp.status}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="font-medium">Suggested games</div>
              <ul className="flex flex-col gap-1">
                {detail.games.map(({ game, voteCount }) => (
                  <li key={game.id} className="flex items-center gap-2">
                    {game.name}
                    <Badge>
                      {voteCount} vote{voteCount === 1 ? '' : 's'}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </DialogSheetContent>
    </Dialog>
  );
}
