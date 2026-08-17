'use client';

import { useState } from 'react';
import { useGroupProposals } from '@/hooks/use-proposals';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';

export function GroupCalendarView({ groupId }: { groupId: string }) {
  const { proposals, loading, error, retry } = useGroupProposals(groupId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div>
      {loading && <p>Loading this group&apos;s schedule…</p>}
      {error && (
        <p className="text-red-600">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}
      <CalendarMonthGrid proposals={proposals} onSelectProposal={(proposal) => setSelectedId(proposal.id)} />
      <ProposalDetailPanel proposalId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
