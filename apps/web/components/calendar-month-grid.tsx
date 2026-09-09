'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { buildMonthGrid, placementDateKey, toDateKey, type CalendarDay } from '@/lib/calendar-grid';
import type { CalendarParticipant, CalendarPlaySummary, Group, Proposal, ProposalWithGroup } from '@/lib/types';
import { InlineProposalPanel } from '@/components/inline-proposal-panel';
import { Button } from '@/components/ui/button';
import { proposalStatusClasses } from '@/components/proposal-status-badge';
import { cn } from '@/lib/cn';
import { CalendarPlayLauncher } from '@/components/calendar-play-launcher';
import { apiFetch } from '@/lib/api';
import { PlayLogDialog } from '@/components/play-log-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { SessionPlaceControl } from '@/components/session-place-control';
import { DisclosureChevron } from '@/components/ui/disclosure-chevron';

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

function participantHue(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

function ParticipantIcons({ participants, leftAligned = false }: { participants: CalendarParticipant[]; leftAligned?: boolean }) {
  return <span className={`${leftAligned ? '' : 'ml-auto'} flex shrink-0 -space-x-1`} aria-label={participants.map((participant) => participant.name).join(', ')}>
    {participants.map((participant) => <Avatar key={participant.id} title={participant.name} className="size-5 border border-surface-raised text-[0.55rem] text-white" style={{ backgroundColor: `hsl(${participantHue(participant.id)} 58% 42%)` }}><AvatarFallback>{participant.name.charAt(0).toUpperCase()}</AvatarFallback></Avatar>)}
  </span>;
}

function Disclosure({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  return <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} aria-hidden={!expanded} inert={!expanded}><div className="overflow-hidden">{children}</div></div>;
}

interface WeekRowExpanderProps {
  isExpanded: boolean;
  date: string | null;
  dayProposals: CalendarItem[];
  dayPlays: CalendarPlaySummary[];
  draftOpen: boolean;
  onSetDraftOpen: (open: boolean) => void;
  groups: Group[];
  defaultGroupId?: string;
  onProposalsChanged?: () => void;
  selectedColumn: number;
  onPlayLogged: () => void;
  expandedPlayId: string | null;
  onExpandedPlayChange: (id: string | null) => void;
}

function WeekRowExpander({
  isExpanded,
  date,
  dayProposals,
  dayPlays,
  draftOpen,
  onSetDraftOpen,
  groups,
  defaultGroupId,
  onProposalsChanged,
  selectedColumn,
  onPlayLogged,
  expandedPlayId,
  onExpandedPlayChange,
}: WeekRowExpanderProps) {
  const [cachedDate, setCachedDate] = useState<string | null>(date);
  const [cachedProposals, setCachedProposals] = useState<CalendarItem[]>(dayProposals);
  const [cachedPlays, setCachedPlays] = useState<CalendarPlaySummary[]>(dayPlays);
  const [cachedDraftOpen, setCachedDraftOpen] = useState<boolean>(draftOpen);
  const [cachedSelectedColumn, setCachedSelectedColumn] = useState(selectedColumn);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [expandedProposals, setExpandedProposals] = useState<Record<string, boolean>>({});
  const [newPlay, setNewPlay] = useState<{ game: CalendarPlaySummary['game']; groupId: string } | null>(null);

  // Keep last state cached during collapse transition
  if (date && date !== cachedDate) {
    setCachedDate(date);
    setCachedProposals(dayProposals);
    setCachedPlays(dayPlays);
    setCachedDraftOpen(draftOpen);
    setCachedSelectedColumn(selectedColumn);
    setNewPlay(null);
  }

  const currentDate = isExpanded ? date : cachedDate;
  const currentProposals = isExpanded ? dayProposals : cachedProposals;
  const currentPlays = isExpanded ? dayPlays : cachedPlays;
  const currentDraftOpen = isExpanded ? draftOpen : cachedDraftOpen;
  const currentSelectedColumn = isExpanded ? selectedColumn : cachedSelectedColumn;
  const today = toDateKey(new Date());
  const canPropose = Boolean(currentDate && currentDate >= today);
  const canLogPlay = Boolean(currentDate && currentDate <= today);

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
        {currentDate && <div className="flex flex-col gap-3">
          {canLogPlay && <div className="grid grid-cols-7"><div className="flex justify-center" style={{ gridColumnStart: currentSelectedColumn + 1 }}><CalendarPlayLauncher date={currentDate} groups={groups} defaultGroupId={defaultGroupId} onLogged={onPlayLogged} onSelectGame={(game, groupId) => setNewPlay({ game, groupId })} /></div></div>}
          {currentProposals.map((proposal) => {
            const expanded = expandedProposals[proposal.id] ?? currentPlays.length === 0;
            return <div key={proposal.id} className="overflow-hidden rounded-sm border border-border bg-surface-raised">
              <div className="flex min-h-11 items-center gap-3 px-3 py-2">
                <button type="button" aria-expanded={expanded} onClick={() => setExpandedProposals((current) => ({ ...current, [proposal.id]: !expanded }))} className="flex min-w-0 shrink-0 items-center gap-3 text-left">
                  <span className="shrink-0 text-sm font-semibold">{expanded ? 'Session details' : proposal.session ? 'Session' : badgeLabel(proposal)}</span>
                  <ParticipantIcons participants={proposal.participants ?? []} leftAligned />
                </button>
                {proposal.session && <div className="w-56 max-w-[40%]"><SessionPlaceControl groupId={proposal.groupId} sessionId={proposal.session.id} place={proposal.session.place} canEdit={Boolean(proposal.canManage)} onChanged={() => { onProposalsChanged?.(); }} /></div>}
                <button type="button" aria-label={expanded ? 'Collapse session details' : 'Expand session details'} aria-expanded={expanded} onClick={() => setExpandedProposals((current) => ({ ...current, [proposal.id]: !expanded }))} className="ml-auto flex self-stretch flex-1 items-center justify-end p-2 text-text-muted"><DisclosureChevron expanded={expanded} /></button>
              </div>
              <Disclosure expanded={expanded}><div className="border-t border-border"><InlineProposalPanel embedded proposalId={proposal.id} groups={groups} defaultGroupId={defaultGroupId} onProposalsChanged={onProposalsChanged} onPlayLogged={onPlayLogged} /></div></Disclosure>
            </div>;
          })}
          {[...new Map(currentPlays.filter((play) => !play.proposalId).map((play) => [play.sessionId, play])).values()].map((session) => <div key={session.sessionId} className="flex min-h-11 flex-wrap items-center gap-3 rounded-sm border border-border bg-surface-raised px-3 py-2">
            <span className="text-xs font-semibold text-text-muted">Logged session</span>
            <ParticipantIcons participants={session.sessionParticipants} leftAligned />
            <div className="w-56 max-w-full"><SessionPlaceControl groupId={session.groupId} sessionId={session.sessionId} place={session.sessionPlace} canEdit={session.canEdit} onChanged={onPlayLogged} /></div>
          </div>)}
          {currentPlays.map((play) => {
            const expanded = expandedPlayId === play.id;
            const artwork = play.game.thumbnail || play.game.image;
            return <div key={play.id} className="overflow-hidden rounded-sm border border-border bg-surface-raised">
              <button type="button" disabled={!play.canEdit} aria-expanded={expanded} onClick={() => onExpandedPlayChange(expanded ? null : play.id)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left disabled:cursor-default">
                {artwork ? (
                  // BGG image hosts are external and vary at runtime.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artwork} alt="" className="size-8 rounded-sm object-cover" />
                ) : <span className="flex size-8 items-center justify-center rounded-sm bg-accent-2 font-display text-accent-2-ink">{play.game.name.charAt(0)}</span>}
                <strong className="min-w-0 truncate">{expanded ? `${play.game.name} play details` : play.game.name}</strong>
                <ParticipantIcons participants={play.sessionParticipants} leftAligned />
                {play.durationMinutes && <span className="shrink-0 text-xs text-text-muted">{play.durationMinutes} min</span>}
                {play.status === 'abandoned' && <span className="shrink-0 text-xs font-semibold text-accent">Abandoned</span>}
                <span className="flex-1" />
                {play.canEdit && <DisclosureChevron expanded={expanded} />}
              </button>
              <Disclosure expanded={expanded}><div className="border-t border-border"><PlayLogDialog inline embedded game={play.game} open={expanded} editPlayId={play.id} defaults={{ groupId: play.groupId, playedDate: play.playedDate, userIds: [] }} onOpenChange={(open) => { if (!open) onExpandedPlayChange(null); }} onLogged={onPlayLogged} /></div></Disclosure>
            </div>;
          })}
          {newPlay && <PlayLogDialog inline game={newPlay.game} open defaults={{ groupId: newPlay.groupId, playedDate: currentDate, userIds: [] }} onOpenChange={(open) => { if (!open) setNewPlay(null); }} onLogged={() => { onPlayLogged(); setNewPlay(null); }} />}
          {canPropose && (currentProposals.length === 0 || currentDraftOpen) ? <InlineProposalPanel proposalId={null} draftDate={currentDate} groups={groups} defaultGroupId={defaultGroupId} onProposalsChanged={onProposalsChanged} onPlayLogged={onPlayLogged} onSelectProposal={() => onSetDraftOpen(false)} /> : canPropose ? <div className="flex justify-start"><Button type="button" variant="secondary" className="px-3 py-1 text-xs" onClick={() => onSetDraftOpen(true)}>+ Add proposal</Button></div> : null}
        </div>}
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
  const [plays, setPlays] = useState<CalendarPlaySummary[]>([]);
  const [playRefresh, setPlayRefresh] = useState(0);
  const [expandedPlayId, setExpandedPlayId] = useState<string | null>(null);
  const groupIdsKey = (defaultGroupId ? [defaultGroupId] : groups.map((group) => group.id)).join(',');

  useEffect(() => {
    if (!groupIdsKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no groups means there are no visible plays.
      setPlays([]);
      return;
    }
    let cancelled = false;
    void Promise.all(groupIdsKey.split(',').map(async (groupId) => {
      const response = await apiFetch(`/groups/${groupId}/plays`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to load logged plays');
      return response.json() as Promise<CalendarPlaySummary[]>;
    })).then((rows) => {
      if (!cancelled) setPlays(rows.flat());
    }).catch(() => {
      if (!cancelled) setPlays([]);
    });
    return () => { cancelled = true; };
  }, [groupIdsKey, playRefresh]);

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

  const playsByDate = useMemo(() => {
    const map = new Map<string, CalendarPlaySummary[]>();
    for (const play of plays) map.set(play.playedDate, [...(map.get(play.playedDate) ?? []), play]);
    return map;
  }, [plays]);

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
          <div key={`${initial}-${index}`} className={cn('text-center text-xs font-medium', index >= 5 ? 'text-accent' : 'text-text-muted')}>
            {initial}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        {weeks.map((week, weekIndex) => {
          const isRowExpanded = activeWeekIndex === weekIndex;
          const dayProposalsForActiveDate = activeDate ? (byDate.get(activeDate) ?? []) : [];
          const dayPlaysForActiveDate = activeDate ? (playsByDate.get(activeDate) ?? []) : [];

          return (
            <div key={`week-${weekIndex}`} className="flex flex-col">
              <div className="grid grid-cols-7 gap-1">
                {week.map(({ date, inMonth }) => {
                  const key = toDateKey(date);
                  const dayProposals = byDate.get(key) ?? [];
                  const dayPlays = playsByDate.get(key) ?? [];
                  const directSessions = [...new Map(dayPlays
                    .filter((play) => !play.proposalId)
                    .map((play) => [play.sessionId, play])).values()];
                  const dayItems = [
                    ...dayProposals.map((item) => ({ id: `proposal:${item.id}`, kind: 'session' as const, label: badgeLabel(item), className: proposalStatusClasses(item.status), participants: item.participants ?? [] })),
                    ...directSessions.map((session) => ({ id: `session:${session.sessionId}`, kind: 'session' as const, label: `Logged session${defaultGroupId ? '' : ` - ${session.groupName}`}`, className: 'bg-surface text-text-muted', participants: session.sessionParticipants })),
                    ...dayPlays.map((play) => ({ id: `play:${play.id}`, kind: 'play' as const, label: `Played ${play.game.name}${defaultGroupId ? '' : ` - ${play.groupName}`}`, className: 'bg-highlight text-text', play })),
                  ];
                  const isSelected = activeDate === key;
                  const dateLabel = date.toLocaleDateString(undefined, { dateStyle: 'long' });
                  const itemCountLabel = dayPlays.length === 0
                    ? `${dayProposals.length} ${dayProposals.length === 1 ? 'proposal' : 'proposals'}`
                    : `${dayProposals.length} ${dayProposals.length === 1 ? 'proposal' : 'proposals'}, ${dayPlays.length} logged ${dayPlays.length === 1 ? 'play' : 'plays'}`;

                  return (
                    <div
                      key={key}
                      className={cn(
                        'relative flex min-h-20 w-full flex-col justify-start rounded border p-1 text-left text-xs transition-colors',
                        isSelected ? 'border-primary ring-1 ring-primary' : 'border-border',
                        inMonth ? 'bg-surface-raised hover:bg-surface' : 'bg-surface text-text-muted hover:bg-surface-raised/50'
                      )}
                    >
                      <button type="button" className="absolute inset-0 rounded" onClick={() => handleSelectDate(key)} aria-label={dayItems.length > 0 ? `${dateLabel}, ${itemCountLabel}` : dateLabel} aria-pressed={isSelected} aria-expanded={isSelected} />
                      <div className="pointer-events-none relative z-[1] flex flex-col">
                      <span className="flex items-center justify-between font-medium">
                        <span className={cn(inMonth && (date.getDay() === 6 || date.getDay() === 0) && 'text-accent')}>{date.getDate()}</span>
                      </span>
                      {dayItems.filter((item) => item.kind === 'session').map((item) => <span key={item.id} title={`${item.label}${item.participants.length ? `: ${item.participants.map((participant) => participant.name).join(', ')}` : ''}`} className={cn('mt-1 flex w-full min-w-0 items-center gap-1 rounded px-1 font-medium', item.className)}><span className="min-w-0 truncate">{item.label}</span>{item.participants.length > 0 && <ParticipantIcons participants={item.participants} />}</span>)}
                      {dayPlays.length > 0 && <span className="mt-1 flex flex-wrap gap-1">
                        {dayItems.filter((item) => item.kind === 'play').map((item) => {
                          if (item.kind !== 'play') return null;
                          const artwork = item.play.game.thumbnail || item.play.game.image;
                          const thumbnail = artwork
                            ? (
                              // BGG image hosts are external and vary at runtime.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={artwork} alt="" className="size-8 rounded-sm object-cover" />
                            )
                            : <span className="flex size-8 items-center justify-center rounded-sm bg-accent-2 font-display text-sm text-accent-2-ink">{item.play.game.name.charAt(0).toUpperCase()}</span>;
                          return item.play.canEdit
                            ? <button key={item.id} type="button" aria-label={item.label} title={item.label} className="pointer-events-auto shrink-0 rounded-sm hover:ring-2 hover:ring-accent-2" onClick={() => { setActiveDate(key); setExpandedPlayId(item.play.id); }}>{thumbnail}</button>
                            : <span key={item.id} aria-label={item.label} title={item.label} className="shrink-0">{thumbnail}</span>;
                        })}
                      </span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Inline Expander with Stacked Date Proposals */}
              <WeekRowExpander
                isExpanded={isRowExpanded}
                date={isRowExpanded ? activeDate : null}
                dayProposals={dayProposalsForActiveDate}
                dayPlays={dayPlaysForActiveDate}
                draftOpen={draftOpen}
                onSetDraftOpen={setDraftOpen}
                groups={groups}
                defaultGroupId={defaultGroupId}
                onProposalsChanged={onProposalsChanged}
                selectedColumn={activeDate ? week.findIndex((day) => toDateKey(day.date) === activeDate) : 0}
                onPlayLogged={() => setPlayRefresh((current) => current + 1)}
                expandedPlayId={expandedPlayId}
                onExpandedPlayChange={setExpandedPlayId}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
