'use client';

import { useState } from 'react';
import { useAggregateProposals } from '@/hooks/use-proposals';
import { useGroups } from '@/hooks/use-groups';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { ProposalDetailPanel } from '@/components/proposal-detail-panel';
import { CreateProposalInlineForm } from '@/components/create-proposal-inline-form';
import { placementDateKey } from '@/lib/calendar-grid';

type CalendarSelection =
  | { kind: 'draft'; dateKey: string }
  | { kind: 'proposal'; id: string; dateKey: string }
  | null;

export default function PersonalCalendarPage() {
  const { proposals, loading, error, retry } = useAggregateProposals();
  const { groups } = useGroups();
  const [selection, setSelection] = useState<CalendarSelection>(null);

  return (
    <div>
      <h2 className="mb-3 font-display text-lg">My schedule</h2>

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
                groups={groups}
                onCreated={(created) => {
                  setSelection({ kind: 'proposal', id: created.id, dateKey: placementDateKey(created) });
                  retry();
                }}
                onCancel={() => setSelection(null)}
              />
            );
          }
          return <ProposalDetailPanel proposalId={selection.id} onClose={() => setSelection(null)} onChanged={retry} />;
        }}
      />
    </div>
  );
}
