'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const labels: Record<CalendarItem['status'], string> = {
    collecting: 'Collecting RSVPs',
    confirming: 'Awaiting confirmation',
    confirmed: 'Confirmed session',
    cancelled: 'Cancelled',
  };
  const base = labels[item.status];
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
}: WeekRowExpanderProps) {
  const [cachedDate, setCachedDate] = useState<string | null>(date);
  const [cachedProposals, setCachedProposals] = useState<CalendarItem[]>(dayProposals);
  const [cachedDraftOpen, setCachedDraftOpen] = useState<boolean>(draftOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  // Keep last state cached during collapse transition
  if (date && date !== cachedDate) {
    setCachedDate(date);
    setCachedProposals(dayProposals);
    setCachedDraftOpen(draftOpen);
  }

  const currentDate = isExpanded ? date : cachedDate;
  const currentProposals = isExpanded ? dayProposals : cachedProposals;
  const currentDraftOpen = isExpanded ? draftOpen : cachedDraftOpen;

  useEffect(() => {
    if (!isExpanded || !contentRef.current) return;

    const updateHeight = () => {
      if (contentRef.current) setContentHeight(contentRef.current.scrollHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [isExpanded, currentDate, currentDraftOpen]);

  return (
    <div
      className={cn(
        'overflow-hidden transition-[height,opacity] duration-300 ease-in-out',
        isExpanded ? 'opacity-100 my-2' : 'opacity-0 my-0'
      )}
      style={{
        height: isExpanded ? (contentHeight === null ? 'auto' : `${contentHeight}px`) : 0,
      }}
    >
      <div ref={contentRef}>
        {currentDate && (
          currentProposals.length === 0 ? (
            <InlineProposalPanel
              proposalId={null}
              draftDate={currentDate}
              groups={groups}
              defaultGroupId={defaultGroupId}
              onProposalsChanged={onProposalsChanged}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {currentProposals.map((proposal) => (
                <InlineProposalPanel
                  key={proposal.id}
                  proposalId={proposal.id}
                  groups={groups}
                  defaultGroupId={defaultGroupId}
                  onProposalsChanged={onProposalsChanged}
                />
              ))}

              {currentDraftOpen ? (
                <InlineProposalPanel
                  proposalId={null}
                  draftDate={currentDate}
                  groups={groups}
                  defaultGroupId={defaultGroupId}
                  onProposalsChanged={onProposalsChanged}
                  onSelectProposal={() => {
                    onSetDraftOpen(false);
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
                  const dateLabel = date.toLocaleDateString(undefined, { dateStyle: 'long' });
                  const proposalCountLabel = `${dayItems.length} ${dayItems.length === 1 ? 'proposal' : 'proposals'}`;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectDate(key)}
                      aria-label={dayItems.length > 0 ? `${dateLabel}, ${proposalCountLabel}` : dateLabel}
                      aria-pressed={isSelected}
                      aria-expanded={isSelected}
                      className={cn(
                        'flex min-h-20 w-full flex-col justify-start rounded border p-1 text-left text-xs cursor-pointer transition-colors',
                        isSelected ? 'border-primary ring-1 ring-primary' : 'border-border',
                        inMonth ? 'bg-surface-raised hover:bg-surface' : 'bg-surface text-text-muted hover:bg-surface-raised/50'
                      )}
                    >
                      <span className="flex items-center justify-between font-medium">
                        <span>{date.getDate()}</span>
                      </span>
                      {shown.map((item) => (
                        <span
                          key={item.id}
                          className="mt-1 block w-full truncate rounded bg-highlight px-1 text-text hover:opacity-80"
                        >
                          {badgeLabel(item)}
                        </span>
                      ))}
                      {overflow > 0 && <span className="mt-1 block text-text-muted">+{overflow} more</span>}
                    </button>
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
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
