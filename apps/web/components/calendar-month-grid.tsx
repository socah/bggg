'use client';

import { useMemo, useState } from 'react';
import { buildMonthGrid, placementDateKey, toDateKey } from '@/lib/calendar-grid';
import type { Proposal, ProposalWithGroup } from '@/lib/types';

const MAX_BADGES_PER_DAY = 3;

// Column labels for the Monday-first grid — one initial per weekday,
// left to right Mon..Sun.
const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

type CalendarItem = Proposal | ProposalWithGroup;

function hasGroupName(item: CalendarItem): item is ProposalWithGroup {
  return 'groupName' in item;
}

function badgeLabel(item: CalendarItem): string {
  const base = item.status === 'confirmed' ? 'Confirmed session' : 'Proposal';
  return hasGroupName(item) ? `${base} — ${item.groupName}` : base;
}

interface CalendarMonthGridProps {
  proposals: CalendarItem[];
  onSelectProposal: (proposal: CalendarItem) => void;
}

export function CalendarMonthGrid({ proposals, onSelectProposal }: CalendarMonthGridProps) {
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date());

  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const proposal of proposals) {
      const key = placementDateKey(proposal);
      const existing = map.get(key) ?? [];
      existing.push(proposal);
      map.set(key, existing);
    }
    return map;
  }, [proposals]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
        >
          ← Prev
        </button>
        <span className="font-semibold">
          {monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
        >
          Next →
        </button>
        <button type="button" onClick={() => setMonthAnchor(new Date())}>
          Today
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAY_INITIALS.map((initial, index) => (
          <div key={`${initial}-${index}`} className="text-center text-xs font-medium text-text-muted">
            {initial}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map(({ date, inMonth }) => {
          const key = toDateKey(date);
          const dayItems = byDate.get(key) ?? [];
          const shown = dayItems.slice(0, MAX_BADGES_PER_DAY);
          const overflow = dayItems.length - shown.length;
          return (
            <div
              key={key}
              className={`min-h-20 rounded border border-border p-1 text-xs ${
                inMonth ? 'bg-surface-raised' : 'bg-surface text-text-muted'
              }`}
            >
              <div className="font-medium">{date.getDate()}</div>
              {shown.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectProposal(item)}
                  className="mt-1 block w-full truncate rounded bg-highlight px-1 text-left text-text"
                >
                  {badgeLabel(item)}
                </button>
              ))}
              {overflow > 0 && <div className="mt-1 text-text-muted">+{overflow} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
