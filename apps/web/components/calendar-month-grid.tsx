'use client';

import { useMemo, useState } from 'react';
import { buildMonthGrid, placementDateKey, toDateKey, type CalendarDay } from '@/lib/calendar-grid';
import type { Group, Proposal, ProposalWithGroup } from '@/lib/types';
import { InlineProposalPanel } from '@/components/inline-proposal-panel';
import { Button } from '@/components/ui/button';
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

interface WeekRowExpanderProps {
  isExpanded: boolean;
  date: string | null;
  dayProposals: CalendarItem[];
  draftOpen: boolean;
  onSetDraftOpen: (open: boolean) => void;
  groups: Group[];
  defaultGroupId?: string;
  onProposalsChanged?: () => void;
  onClose: () => void;
}

function WeekRowExpander({
  isExpanded,
  date,
  dayProposals,
  draftOpen,
  onSetDraftOpen,
  groups,
  defaultGroupId,
  onProposalsChanged,
  onClose,
}: WeekRowExpanderProps) {
  const [cachedDate, setCachedDate] = useState<string | null>(date);
  const [cachedProposals, setCachedProposals] = useState<CalendarItem[]>(dayProposals);
  const [cachedDraftOpen, setCachedDraftOpen] = useState<boolean>(draftOpen);

  // Keep last state cached during collapse transition
  if (date && date !== cachedDate) {
    setCachedDate(date);
    setCachedProposals(dayProposals);
    setCachedDraftOpen(draftOpen);
  }

  const currentDate = isExpanded ? date : cachedDate;
  const currentProposals = isExpanded ? dayProposals : cachedProposals;
  const currentDraftOpen = isExpanded ? draftOpen : cachedDraftOpen;

  return (
    <div
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out',
        isExpanded ? 'grid-rows-[1fr] opacity-100 my-2' : 'grid-rows-[0fr] opacity-0 my-0'
      )}
    >
      <div className="overflow-hidden">
        {currentDate && (
          currentProposals.length === 0 ? (
            <InlineProposalPanel
              proposalId={null}
              draftDate={currentDate}
              groups={groups}
              defaultGroupId={defaultGroupId}
              onClose={onClose}
              onProposalsChanged={onProposalsChanged}
              onSelectProposal={() => {
                onProposalsChanged?.();
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {currentProposals.map((proposal) => (
                <InlineProposalPanel
                  key={proposal.id}
                  proposalId={proposal.id}
                  groups={groups}
                  defaultGroupId={defaultGroupId}
                  onClose={onClose}
                  onProposalsChanged={onProposalsChanged}
                />
              ))}

              {currentDraftOpen ? (
                <InlineProposalPanel
                  proposalId={null}
                  draftDate={currentDate}
                  groups={groups}
                  defaultGroupId={defaultGroupId}
                  onClose={() => onSetDraftOpen(false)}
                  onProposalsChanged={onProposalsChanged}
                  onSelectProposal={() => {
                    onSetDraftOpen(false);
                    onProposalsChanged?.();
                  }}
                />
              ) : (
                <div className="flex justify-start">
                  <Button
                    type="button"
                    variant="secondary"
                    className="text-xs px-3 py-1"
                    onClick={() => onSetDraftOpen(true)}
                  >
                    + Add proposal
                  </Button>
                </div>
              )}
            </div>
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
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);

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
    if (!activeDate) return -1;
    return weeks.findIndex((week) =>
      week.some((day) => toDateKey(day.date) === activeDate)
    );
  }, [activeDate, weeks]);

  function handleSelectDate(key: string) {
    if (activeDate === key) {
      setActiveDate(null);
      setDraftOpen(false);
    } else {
      setActiveDate(key);
      setDraftOpen(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            setActiveDate(null);
            setDraftOpen(false);
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
            setActiveDate(null);
            setDraftOpen(false);
            setMonthAnchor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
          }}
          className="text-xs text-text-muted hover:text-text"
        >
          Next →
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveDate(null);
            setDraftOpen(false);
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
          const dayProposalsForActiveDate = activeDate ? (byDate.get(activeDate) ?? []) : [];

          return (
            <div key={`week-${weekIndex}`} className="flex flex-col">
              <div className="grid grid-cols-7 gap-1">
                {week.map(({ date, inMonth }) => {
                  const key = toDateKey(date);
                  const dayItems = byDate.get(key) ?? [];
                  const shown = dayItems.slice(0, MAX_BADGES_PER_DAY);
                  const overflow = dayItems.length - shown.length;
                  const isSelected = activeDate === key;

                  return (
                    <div
                      key={key}
                      onClick={() => handleSelectDate(key)}
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
                            handleSelectDate(key);
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

              {/* Inline Expander with Stacked Date Proposals */}
              <WeekRowExpander
                isExpanded={isRowExpanded}
                date={isRowExpanded ? activeDate : null}
                dayProposals={dayProposalsForActiveDate}
                draftOpen={draftOpen}
                onSetDraftOpen={setDraftOpen}
                groups={groups}
                defaultGroupId={defaultGroupId}
                onProposalsChanged={onProposalsChanged}
                onClose={() => {
                  setActiveDate(null);
                  setDraftOpen(false);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
