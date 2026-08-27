'use client';

import { useState } from 'react';
import { useAggregateProposals } from '@/hooks/use-proposals';
import { useGroups } from '@/hooks/use-groups';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';
import { CreateProposalDialog } from '@/components/create-proposal-dialog';
import { Button } from '@/components/ui/button';

export default function PersonalCalendarPage() {
  const { proposals, loading, error, retry } = useAggregateProposals();
  const { groups } = useGroups();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">My schedule</h2>
        <Button type="button" className="px-3 py-1 text-xs" onClick={() => setCreateOpen(true)}>
          + New proposal
        </Button>
      </div>

      {loading && <p>Loading your schedule…</p>}
      {error && (
        <p className="text-accent">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}
      <CalendarMonthGrid
        proposals={proposals}
        selectedDateKey={selectedDateKey ?? undefined}
        onSelectDate={setSelectedDateKey}
        onSelectProposal={(proposal) => setSelectedId(proposal.id)}
      />
      <ProposalDetailPanel proposalId={selectedId} onClose={() => setSelectedId(null)} onChanged={retry} />

      <CreateProposalDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groups={groups}
        onCreated={(created) => {
          setSelectedId(created.id);
          retry();
        }}
      />
    </div>
  );
}
