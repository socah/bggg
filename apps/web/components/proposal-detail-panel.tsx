'use client';

import { useProposalDetail } from '@/hooks/use-proposal-detail';
import { useGroupMembers } from '@/hooks/use-group-members';

interface ProposalDetailPanelProps {
  proposalId: string | null;
  onClose: () => void;
}

export function ProposalDetailPanel({ proposalId, onClose }: ProposalDetailPanelProps) {
  const { detail, loading, notFound, error, retry } = useProposalDetail(proposalId);
  const members = useGroupMembers(detail?.proposal.groupId ?? null);

  if (!proposalId) return null;

  function nameFor(userId: string): string {
    return members.find((m) => m.id === userId)?.displayName ?? userId;
  }

  return (
    <div className="fixed inset-y-0 right-0 w-80 overflow-y-auto border-l border-gray-200 bg-white p-4 shadow-lg">
      <button type="button" onClick={onClose} className="mb-2 text-sm text-gray-500">
        Close ✕
      </button>

      {loading && <p>Loading…</p>}
      {notFound && <p>This item is no longer available.</p>}
      {error && (
        <p className="text-red-600">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}

      {detail && (
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-semibold">{detail.proposal.proposedDate}</div>
            <div className="text-gray-600">Status: {detail.proposal.status}</div>
            <div className="text-gray-600">Proposed by: {nameFor(detail.proposal.createdBy)}</div>
            {detail.proposal.hostId && (
              <div className="text-gray-600">Host: {nameFor(detail.proposal.hostId)}</div>
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
            <ul>
              {detail.games.map(({ game, voteCount }) => (
                <li key={game.id}>
                  {game.name} ({voteCount} vote{voteCount === 1 ? '' : 's'})
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
