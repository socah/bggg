'use client';

import { useAggregateProposals } from '@/hooks/use-proposals';
import { useGroups } from '@/hooks/use-groups';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';

export default function PersonalCalendarPage() {
  const { proposals, loading, error, retry } = useAggregateProposals();
  const { groups } = useGroups();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">My schedule</h2>
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
        groups={groups}
        onProposalsChanged={retry}
      />
    </div>
  );
}
