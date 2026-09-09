'use client';

import { useMemo, useState } from 'react';
import { useGroupLibrary } from '@/hooks/use-group-library';
import { PlayLogDialog } from '@/components/play-log-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogSheetContent, DialogTitle } from '@/components/ui/dialog';
import type { GameCardGame, Group } from '@/lib/types';

export function CalendarPlayLauncher({ date, groups, defaultGroupId, onLogged, onSelectGame }: { date: string; groups: Group[]; defaultGroupId?: string; onLogged?: () => void; onSelectGame?: (game: GameCardGame, groupId: string) => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupId, setGroupId] = useState(defaultGroupId ?? groups[0]?.id ?? '');
  const [filter, setFilter] = useState('');
  const [game, setGame] = useState<GameCardGame | null>(null);
  const effectiveGroupId = defaultGroupId || groupId || groups[0]?.id || '';
  const library = useGroupLibrary(effectiveGroupId || null);
  const filteredGames = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? library.games.filter((candidate) => candidate.name.toLowerCase().includes(query)) : library.games;
  }, [filter, library.games]);

  return <>
    <Button type="button" variant="secondary" className="px-3 text-xs" disabled={groups.length === 0} onClick={() => setPickerOpen(true)}>Log a play</Button>
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
      <DialogSheetContent aria-describedby={undefined}>
        <DialogTitle className="font-display text-xl">Choose a game</DialogTitle>
        <DialogClose className="mb-3 mt-1 block text-sm text-text-muted">Close</DialogClose>
        {!defaultGroupId && <label className="text-xs font-semibold text-text-muted">Group<select value={effectiveGroupId} onChange={(event) => setGroupId(event.target.value)} className="mb-3 mt-1 min-h-10 w-full rounded-sm border border-border bg-surface px-2 text-sm text-text">{groups.map((group) => <option key={group.id} value={group.id}>{group.isSolo ? `${group.name} (solo)` : group.name}</option>)}</select></label>}
        <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter games..." className="mb-3 min-h-10 w-full rounded-sm border border-border bg-surface px-2 text-sm" />
        {library.loading && <p className="text-sm text-text-muted">Loading games...</p>}
        {library.error && <p role="alert" className="text-sm text-accent">{library.error}</p>}
        <div className="flex flex-col gap-1">{filteredGames.map((candidate) => <button type="button" key={candidate.id} className="rounded-sm bg-surface p-2 text-left text-sm font-semibold hover:bg-highlight" onClick={() => { if (onSelectGame) onSelectGame(candidate, effectiveGroupId); else setGame(candidate); setPickerOpen(false); }}>{candidate.name}</button>)}</div>
      </DialogSheetContent>
    </Dialog>
    {game && !onSelectGame && <PlayLogDialog game={game} open defaults={{ groupId: effectiveGroupId, playedDate: date, userIds: [] }} onOpenChange={(open) => { if (!open) setGame(null); }} onLogged={onLogged} />}
  </>;
}
