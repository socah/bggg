import { buildMonthGrid } from '@/lib/calendar-grid';

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

export function CalendarMonthSkeleton({ label }: { label: string }) {
  const grid = buildMonthGrid(new Date());
  const weeks = Array.from({ length: grid.length / 7 }, (_, index) =>
    grid.slice(index * 7, index * 7 + 7),
  );

  return (
    <div role="status" aria-label={label}>
      <div aria-hidden="true" className="animate-pulse">
        <div className="mb-2 flex items-center justify-between">
          <div className="h-4 w-10 rounded-sm bg-border" />
          <div className="h-5 w-28 rounded-sm bg-border" />
          <div className="h-4 w-10 rounded-sm bg-border" />
          <div className="h-4 w-10 rounded-sm bg-border" />
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1">
          {WEEKDAY_INITIALS.map((initial, index) => (
            <div key={`${initial}-${index}`} className="text-center text-xs text-text-muted/50">
              {initial}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} data-calendar-week className="grid grid-cols-7 gap-1">
              {week.map((_, dayIndex) => {
                const index = weekIndex * 7 + dayIndex;
                return (
                  <div
                    key={dayIndex}
                    data-calendar-day
                    className="min-h-20 rounded border border-border bg-surface-raised p-1"
                  >
                    <div className="h-3 w-4 rounded-sm bg-border" />
                    {index % 4 === 0 && <div className="mt-2 h-4 w-full rounded bg-highlight/60" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
