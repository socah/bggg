'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { GameDetailsSheet, LibraryGame } from '@/components/personal-collection';
import { useGroupLibrary } from '@/hooks/use-group-library';
import type { GameCardGame } from '@/lib/types';

type ViewMode = 'compact' | 'list';
type SortMode = 'name' | 'rating' | 'players' | 'time' | 'year';

const sortLabels: Record<SortMode, string> = {
  name: 'Name', rating: 'BGG rating', players: 'Minimum players', time: 'Playing time', year: 'Year published',
};

export function GroupLibrary({ groupId }: { groupId: string }) {
  const { games, loading, error, reload } = useGroupLibrary(groupId);
  const [view, setView] = useState<ViewMode>('compact');
  const [selected, setSelected] = useState<GameCardGame | null>(null);
  const [filter, setFilter] = useState('');
  const [playerCount, setPlayerCount] = useState('');
  const [sort, setSort] = useState<SortMode>('name');
  const count = Number(playerCount);
  const visibleGames = [...games]
    .filter((game) => game.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())
      && (!count || (game.minPlayers <= count && game.maxPlayers >= count)))
    .sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating || a.name.localeCompare(b.name);
      if (sort === 'players') return a.minPlayers - b.minPlayers || a.maxPlayers - b.maxPlayers || a.name.localeCompare(b.name);
      if (sort === 'time') return a.playingTime - b.playingTime || a.name.localeCompare(b.name);
      if (sort === 'year') return b.yearPublished - a.yearPublished || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

  function changePlayerCount(delta: number) {
    const next = (Number(playerCount) || 0) + delta;
    setPlayerCount(next > 0 ? String(next) : '');
  }

  if (loading) {
    return <p role="status" className="py-12 text-center text-sm text-text-muted">Loading group library...</p>;
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-sm text-accent">{error}</p>
        <Button type="button" variant="secondary" onClick={reload}>Retry</Button>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-text-muted">
        This group library is empty. Games appear here when members add games or import their BGG collections.
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by title" aria-label="Filter by title" />
          <span className="flex" aria-label="Player count">
            <button type="button" onClick={() => changePlayerCount(-1)} className="min-h-10 w-10 rounded-l-sm border-[length:var(--border-w)] border-border text-lg" aria-label="Decrease player count">-</button>
            <Input type="text" inputMode="numeric" value={playerCount ? `Player count: ${playerCount}` : 'Player count: Any'} onChange={(event) => setPlayerCount(event.target.value.replace(/\D/g, ''))} aria-label="Player count value" className="min-w-0 rounded-none text-center" />
            <button type="button" onClick={() => changePlayerCount(1)} className="min-h-10 w-10 rounded-r-sm border-[length:var(--border-w)] border-border text-lg" aria-label="Increase player count">+</button>
          </span>
          <select aria-label="Sort by" value={`display:${sort}`} onChange={(event) => setSort(event.target.value as SortMode)} className="min-h-10 rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised px-2 text-sm text-text">
            <option value={`display:${sort}`} hidden>Sort by: {sortLabels[sort]}</option>
            <option value="name">Name</option><option value="rating">BGG rating</option><option value="players">Minimum players</option><option value="time">Playing time</option><option value="year">Year published</option>
          </select>
          <div className="flex min-h-10 overflow-hidden rounded-sm border-[length:var(--border-w)] border-border" aria-label="View style">
            <button type="button" aria-pressed={view === 'compact'} onClick={() => setView('compact')} className={`flex-1 px-3 text-sm font-semibold ${view === 'compact' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>Grid</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`flex-1 border-l border-border px-3 text-sm font-semibold ${view === 'list' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>List</button>
          </div>
        </div>
      </Card>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{visibleGames.length} of {games.length} games from group members</p>
      </div>
      {visibleGames.length === 0 && <Card className="p-8 text-center text-sm text-text-muted">No games match this view.</Card>}
      <div className={view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' : 'flex flex-col gap-3'}>
        {visibleGames.map((game) => <LibraryGame key={game.id} game={game} view={view} onOpen={() => setSelected(game)} />)}
      </div>
      <GameDetailsSheet game={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}
