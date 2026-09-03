'use client';

import { useGroupProposals } from '@/hooks/use-proposals';
import { useGroups } from '@/hooks/use-groups';
import { CalendarMonthGrid } from '@/components/calendar-month-grid';
import { CalendarMonthSkeleton } from '@/components/calendar-month-skeleton';

export function GroupCalendarView({ groupId }: { groupId: string }) {
  const { proposals, loading, error, retry } = useGroupProposals(groupId);
  const { groups } = useGroups();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">Schedule</h2>
      </div>

      {error && (
        <p className="text-accent">
          {error}{' '}
          <button type="button" onClick={retry} className="underline">
            Retry
          </button>
        </p>
      )}
      {loading ? (
        <CalendarMonthSkeleton label="Loading this group's schedule" />
      ) : (
        <CalendarMonthGrid
          proposals={proposals}
          groups={groups.length > 0 ? groups : [{ id: groupId, name: 'This group', ownerId: '', isSolo: false, createdAt: '' }]}
          defaultGroupId={groupId}
          onProposalsChanged={retry}
        />
      )}
    </div>
  );
}
