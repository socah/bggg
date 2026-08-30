'use client';

import { useMemo, useState } from 'react';
import { buildMonthGrid, placementDateKey, toDateKey, type CalendarDay } from '@/lib/calendar-grid';
import type { Group, Proposal, ProposalWithGroup } from '@/lib/types';
import { InlineCreateProposal } from '@/components/inline-create-proposal';
import { InlineProposalDetail } from '@/components/inline-proposal-detail';
import { cn } from '@/lib/cn';

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

export type ActiveSelection =
  | { type: 'draft'; date: string }
  | { type: 'proposal'; proposalId: string; date: string }
  | null;

interface WeekRowExpanderProps {
  isExpanded: boolean;
  selection: ActiveSelection;
  groups: Group[];
  defaultGroupId?: string;
  onProposalsChanged?: () => void;
  onSelectCreatedProposal: (proposal: Proposal) => void;
  onClose: () => void;
}

function WeekRowExpander({
  isExpanded,
  selection,
  groups,
  defaultGroupId,
  onProposalsChanged,
  onSelectCreatedProposal,
  onClose,
}: WeekRowExpanderProps) {
  const [cachedSelection, setCachedSelection] = useState<ActiveSelection>(selection);

  // Keep the last valid selection cached during collapse animation
  if (selection && selection !== cachedSelection) {
    setCachedSelection(selection);
  }

  const current = isExpanded ? selection : cachedSelection;

  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out',
        isExpanded ? 'grid-rows-[1fr] opacity-100 my-2' : 'grid-rows-[0fr] opacity-0 my-0'
      )}
    >
      <div className="overflow-hidden">
        {current && (
          current.type === 'draft' ? (
            <InlineCreateProposal
              date={current.date}
              groups={groups}
              defaultGroupId={defaultGroupId}
              onCreated={onSelectCreatedProposal}
              onCancel={onClose}
            />
          ) : (
            <InlineProposalDetail
              proposalId={current.proposalId}
              onClose={onClose}
              onChanged={onProposalsChanged}
            />
          )
        )}
      </div>
    </div>
  );
}

export interface CalendarMonthGridProps {
  proposals: CalendarItem[];
  groups?: Group[];
  defaultGroupId?: string;
  onProposalsChanged?: () => void;
}

export function CalendarMonthGrid({
  proposals,
  groups = [],
  defaultGroupId,
  onProposalsChanged,
}: CalendarMonthGridProps) {
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date());
  const [activeSelection, setActiveSelection] = useState<ActiveSelection>(null);

  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const weeks = useMemo(() => {
    const rows: CalendarDay[][] = [];
    for (let i = 0; i < grid.length; i += 7) {
      rows.push(grid.slice(i, i + 7));
    }
    return rows;
  }, [grid]);

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

  // Determine which week row (if any) contains the currently selected date
  const activeWeekIndex = useMemo(() => {
    if (!activeSelection) return -1;
    return weeks.findIndex((week) =>
      week.some((day) => toDateKey(day.date) === activeSelection.date)
    );
  }, [activeSelection, weeks]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setActiveSelection(null);
            setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
          }}
          className="text-xs text-text-muted hover:text-text"
        >
          ← Prev
        </button>
        <span className="font-semibold text-sm">
          {monthAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          onClick={() => {
            setActiveSelection(null);
            setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
          }}
          className="text-xs text-text-muted hover:text-text"
        >
          Next →
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSelection(null);
            setMonthAnchor(new Date());
          }}
          className="text-xs text-text-muted hover:text-text underline"
        >
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

      <div className="flex flex-col gap-1">
        {weeks.map((week, weekIndex) => {
          const isRowExpanded = activeWeekIndex === weekIndex;

          return (
            <div key={`week-${weekIndex}`} className="flex flex-col">
              <div className="grid grid-cols-7 gap-1">
                {week.map(({ date, inMonth }) => {
                  const key = toDateKey(date);
                  const dayItems = byDate.get(key) ?? [];
                  const shown = dayItems.slice(0, MAX_BADGES_PER_DAY);
                  const overflow = dayItems.length - shown.length;
                  const isSelected = activeSelection?.date === key;

                  return (
                    <div
                      key={key}
                      onClick={() => {
                        setActiveSelection((prev) =>
                          prev?.type === 'draft' && prev.date === key
                            ? null
                            : { type: 'draft', date: key }
                        );
                      }}
                      className={cn(
                        'min-h-20 rounded border p-1 text-xs cursor-pointer transition-colors',
                        isSelected ? 'border-primary ring-1 ring-primary' : 'border-border',
                        inMonth ? 'bg-surface-raised hover:bg-surface' : 'bg-surface text-text-muted hover:bg-surface-raised/50'
                      )}
                    >
                      <div className="flex items-center justify-between font-medium">
                        <span>{date.getDate()}</span>
                      </div>
                      {shown.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveSelection((prev) =>
                              prev?.type === 'proposal' && prev.proposalId === item.id
                                ? null
                                : { type: 'proposal', proposalId: item.id, date: key }
                            );
                          }}
                          className="mt-1 block w-full truncate rounded bg-highlight px-1 text-left text-text hover:opacity-80"
                        >
                          {badgeLabel(item)}
                        </button>
                      ))}
                      {overflow > 0 && <div className="mt-1 text-text-muted">+{overflow} more</div>}
                    </div>
                  );
                })}
              </div>

              {/* Inline Expander with Symmetrical Smooth Transition */}
              <WeekRowExpander
                isExpanded={isRowExpanded}
                selection={isRowExpanded ? activeSelection : null}
                groups={groups}
                defaultGroupId={defaultGroupId}
                onProposalsChanged={onProposalsChanged}
                onSelectCreatedProposal={(created) => {
                  onProposalsChanged?.();
                  setActiveSelection({
                    type: 'proposal',
                    proposalId: created.id,
                    date: created.proposedDate,
                  });
                }}
                onClose={() => setActiveSelection(null)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
