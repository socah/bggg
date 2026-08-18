'use client';

import { useState } from 'react';
import { useAggregateProposals } from '@/hooks/use-proposals';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';

export default function PersonalCalendarPage() {
  const { proposals, loading, error, retry } = useAggregateProposals();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div>
      {loading && <p>Loading your schedule…</p>}
      {error && (
        <p className="text-accent">
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
