'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GameDetailsSheet, LibraryGame } from '@/components/personal-collection';
import type { CollectionGame, GameCardGame, PersonalGameList, PersonalListGame } from '@/lib/types';

type LibraryTab = 'collection' | 'wishlist' | 'saved' | `list:${string}`;
type ViewMode = 'compact' | 'list';
type SortMode = 'name' | 'rating' | 'players' | 'time' | 'year';
const sortLabels: Record<SortMode, string> = { name: 'Name', rating: 'BGG rating', players: 'Minimum players', time: 'Playing time', year: 'Year published' };

function sortGames(games: Array<CollectionGame | PersonalListGame>, sort: SortMode) {
  return [...games].sort((a, b) => {
    if (sort === 'rating') return b.rating - a.rating || a.name.localeCompare(b.name);
    if (sort === 'players') return a.minPlayers - b.minPlayers || a.maxPlayers - b.maxPlayers || a.name.localeCompare(b.name);
    if (sort === 'time') return a.playingTime - b.playingTime || a.name.localeCompare(b.name);
    if (sort === 'year') return b.yearPublished - a.yearPublished || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

export function CollectionBrowser({
  collection,
  wishlist,
  saved,
  lists,
}: {
  collection: CollectionGame[];
  wishlist: CollectionGame[];
  saved: CollectionGame[];
  lists: PersonalGameList[];
}) {
  const [tab, setTab] = useState<LibraryTab>('collection');
  const [view, setView] = useState<ViewMode>('compact');
  const [sort, setSort] = useState<SortMode>('name');
  const [filter, setFilter] = useState('');
  const [playerCount, setPlayerCount] = useState('');
  const [selected, setSelected] = useState<GameCardGame | null>(null);
  const activeList = tab.startsWith('list:') ? lists.find((list) => `list:${list.id}` === tab) : undefined;
  const games: Array<CollectionGame | PersonalListGame> = tab === 'collection'
    ? collection
    : tab === 'wishlist'
      ? wishlist
      : tab === 'saved'
        ? saved
        : activeList?.items ?? [];
  const count = Number(playerCount);
  const visibleGames = sortGames(games.filter((game) =>
    game.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())
      && (!count || (game.minPlayers <= count && game.maxPlayers >= count)),
  ), sort);

  function openGame(game: GameCardGame) {
    setSelected(game);
  }

  function changePlayerCount(delta: number) {
    const next = (Number(playerCount) || 0) + delta;
    setPlayerCount(next > 0 ? String(next) : '');
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto border-b border-border">
        <Tabs value={tab} onValueChange={(value) => setTab(value as LibraryTab)}>
          <TabsList>
            <TabsTrigger value="collection">Collection ({collection.length})</TabsTrigger>
            <TabsTrigger value="wishlist">Wishlist ({wishlist.length})</TabsTrigger>
            <TabsTrigger value="saved">Saved ({saved.length})</TabsTrigger>
            {lists.map((list) => <TabsTrigger key={list.id} value={`list:${list.id}`}>{list.type === 'tier' ? 'Tier: ' : ''}{list.name} ({list.items.length})</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by title" aria-label="Filter by title" />
          <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
            <span className="flex" aria-label="Player count">
              <button type="button" onClick={() => changePlayerCount(-1)} className="min-h-10 w-10 rounded-l-sm border-[length:var(--border-w)] border-border text-lg" aria-label="Decrease player count">-</button>
              <Input type="text" inputMode="numeric" value={playerCount ? `Player count: ${playerCount}` : 'Player count: Any'} onChange={(event) => setPlayerCount(event.target.value.replace(/\D/g, ''))} aria-label="Player count value" className="min-w-0 rounded-none text-center" />
              <button type="button" onClick={() => changePlayerCount(1)} className="min-h-10 w-10 rounded-r-sm border-[length:var(--border-w)] border-border text-lg" aria-label="Increase player count">+</button>
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-text-muted">
            <select aria-label="Sort by" value={`display:${sort}`} onChange={(event) => setSort(event.target.value as SortMode)} className="min-h-10 rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised px-2 text-sm text-text">
              <option value={`display:${sort}`} hidden>Sort by: {sortLabels[sort]}</option>
              <option value="name">Name</option><option value="rating">BGG rating</option><option value="players">Minimum players</option><option value="time">Playing time</option><option value="year">Year published</option>
            </select>
          </label>
          <div className="flex min-h-10 self-end overflow-hidden rounded-sm border-[length:var(--border-w)] border-border" aria-label="View style">
            <button type="button" aria-pressed={view === 'compact'} onClick={() => setView('compact')} className={`flex-1 px-3 text-sm font-semibold ${view === 'compact' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>Grid</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`flex-1 border-l border-border px-3 text-sm font-semibold ${view === 'list' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>List</button>
          </div>
        </div>
      </Card>

      {visibleGames.length === 0 && activeList?.type !== 'tier' ? (
        <Card className="p-8 text-center text-sm text-text-muted">No games match this view.</Card>
      ) : activeList?.type === 'tier' ? (
        <div className="flex flex-col gap-5">
          {[...activeList.tiers, 'Unranked'].map((tier) => {
            const tierValue = tier === 'Unranked' ? null : tier;
            const tierGames = visibleGames
              .filter((game) => (game as PersonalListGame).tier === tierValue)
              .sort((a, b) => (a as PersonalListGame).position - (b as PersonalListGame).position);
            return <section key={tier} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
              <div className="rounded-sm bg-surface p-2 text-center"><h3 className="break-all font-display text-lg leading-tight">{tier}</h3></div>
              <div className={`${view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'flex flex-col gap-3'} min-h-20 rounded-sm border border-dashed border-border p-2`}>
                {tierGames.map((game) => <LibraryGame key={game.id} game={game} view={view} onOpen={() => openGame(game)} />)}
                {tierGames.length === 0 && <p className="self-center text-sm text-text-muted">No games in this tier.</p>}
              </div>
            </section>;
          })}
        </div>
      ) : (
        <div className={view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' : 'flex flex-col gap-3'}>
          {visibleGames.map((game) => <LibraryGame key={game.id} game={game} view={view} onOpen={() => openGame(game)} />)}
        </div>
      )}

      <GameDetailsSheet game={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}
