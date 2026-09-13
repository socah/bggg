'use client';

import { useState } from 'react';
import { useGroupLibrary } from '@/hooks/use-group-library';
import { PlayLogDialog } from '@/components/play-log-dialog';
import { Button } from '@/components/ui/button';
import { GamePickerDialog } from '@/components/game-picker-dialog';
import type { GameCardGame, Group } from '@/lib/types';

export function CalendarPlayLauncher({ date, groups, defaultGroupId, onLogged, onSelectGame, compact = false }: { date: string; groups: Group[]; defaultGroupId?: string; onLogged?: () => void; onSelectGame?: (game: GameCardGame, groupId: string) => void; compact?: boolean }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? '');
  const [game, setGame] = useState<GameCardGame | null>(null);
  const effectiveGroupId = defaultGroupId || groupId || groups[0]?.id || '';
  const library = useGroupLibrary(pickerOpen ? effectiveGroupId || null : null);

  return <>
    <Button type="button" variant="secondary" className={compact ? 'min-h-9 w-full min-w-0 max-w-full whitespace-normal px-0.5 text-[0.6rem] leading-tight @min-[5rem]/day:px-2 @min-[5rem]/day:text-xs' : 'px-3 text-xs'} disabled={groups.length === 0} onClick={() => setPickerOpen(true)}>Log a play</Button>
    <GamePickerDialog singleSelect open={pickerOpen} title="Choose a game" games={library.games} loading={library.loading} error={library.error} onOpenChange={setPickerOpen} controls={!defaultGroupId ? <label className="mb-3 block text-xs font-semibold text-text-muted">Group<select value={effectiveGroupId} onChange={(event) => setGroupId(event.target.value)} className="mt-1 min-h-10 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text">{groups.map((group) => <option key={group.id} value={group.id}>{group.isSolo ? `${group.name} (solo)` : group.name}</option>)}</select></label> : undefined} onAdd={(candidate) => { if (onSelectGame) onSelectGame(candidate, effectiveGroupId); else setGame(candidate); return true; }} />
    {game && !onSelectGame && <PlayLogDialog game={game} open defaults={{ groupId: effectiveGroupId, playedDate: date, userIds: [] }} onOpenChange={(open) => { if (!open) setGame(null); }} onLogged={onLogged} />}
  </>;
}
