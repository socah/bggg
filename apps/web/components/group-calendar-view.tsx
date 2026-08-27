'use client';

import { useState } from 'react';
import { useGroupProposals } from '@/hooks/use-proposals';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';
import { CreateProposalInlineForm } from '@/components/create-proposal-inline-form';
import { placementDateKey } from '@/lib/calendar-grid';

type CalendarSelection =
  | { kind: 'draft'; dateKey: string }
  | { kind: 'proposal'; id: string; dateKey: string }
  | null;

export function GroupCalendarView({ groupId }: { groupId: string }) {
  const { proposals, loading, error, retry } = useGroupProposals(groupId);
  const [selection, setSelection] = useState<CalendarSelection>(null);

  // Any successful panel action can move badges between days (finalize
  // re-dates placement, undo/cancel removes them) — bump the list too.
  const refreshAll = () => {
    retry();
  };

  return (
    <div>
      <h2 className="mb-3 font-display text-lg">Schedule</h2>

      {loading && <p>Loading this group&apos;s schedule…</p>}
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
        selectedDateKey={selection?.dateKey}
        onSelectDate={(dateKey) => setSelection({ kind: 'draft', dateKey })}
        onSelectProposal={(proposal) =>
          setSelection({ kind: 'proposal', id: proposal.id, dateKey: placementDateKey(proposal) })
        }
        renderInlineContent={() => {
          if (!selection) return null;
          if (selection.kind === 'draft') {
            return (
              <CreateProposalInlineForm
                key={selection.dateKey}
                date={selection.dateKey}
                groups={[]}
                defaultGroupId={groupId}
                onCreated={(created) => {
                  setSelection({ kind: 'proposal', id: created.id, dateKey: placementDateKey(created) });
                  refreshAll();
                }}
                onCancel={() => setSelection(null)}
              />
            );
          }
          return <ProposalDetailPanel proposalId={selection.id} onClose={() => setSelection(null)} onChanged={refreshAll} />;
        }}
      />
    </div>
  );
}
