'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CollectionListAccordion } from '@/components/collection-list-accordion';
import { CollectionViewControls } from '@/components/collection-view-controls';
import { bestCollectionMatch, matchesCollectionFilters } from '@/lib/collection-filter';
import { gameMembershipLabels, GameDetailsSheet, LibraryGame } from '@/components/personal-collection';
import { rankCollectionPreviewGames } from '@/lib/collection-list-preview';
import { compareWishlistPriority } from '@/lib/wishlist-priority';
import type { CollectionGame, GameCardGame, PersonalGameList, PersonalListGame, PersonalReview } from '@/lib/types';

type LibraryTab = 'collection' | 'wishlist' | 'saved' | `list:${string}`;
type ViewMode = 'compact' | 'list';
type SortMode = 'name' | 'rating' | 'userRating' | 'complexity' | 'depth' | 'players' | 'time' | 'year';
const sortLabels: Record<SortMode, string> = { name: 'Name', rating: 'BGG rating', userRating: 'User rating', complexity: 'Complexity', depth: 'Depth', players: 'Minimum players', time: 'Playing time', year: 'Year published' };

function sortGames(games: Array<CollectionGame | PersonalListGame>, sort: SortMode, reviews: PersonalReview[], isWishlist: boolean) {
  const reviewByGameId = new Map(reviews.map((review) => [review.gameId, review]));
  return [...games].sort((a, b) => {
    if (isWishlist) {
      const priorityOrder = compareWishlistPriority(a, b);
      if (priorityOrder) return priorityOrder;
    }
    if (sort === 'rating') return b.rating - a.rating || a.name.localeCompare(b.name);
    if (sort === 'userRating' || sort === 'complexity' || sort === 'depth') {
      const field = sort === 'userRating' ? 'rating' : sort === 'complexity' ? 'complexityScore' : 'depthScore';
      return (reviewByGameId.get(b.id)?.[field] ?? -1) - (reviewByGameId.get(a.id)?.[field] ?? -1) || a.name.localeCompare(b.name);
    }
    if (sort === 'players') return a.minPlayers - b.minPlayers || a.maxPlayers - b.maxPlayers || a.name.localeCompare(b.name);
    if (sort === 'time') return a.playingTime - b.playingTime || a.name.localeCompare(b.name);
    if (sort === 'year') return b.yearPublished - a.yearPublished || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
}

export function CollectionBrowser({
  groupId,
  collection,
  wishlist,
  saved,
  lists,
  reviews = [],
}: {
  groupId?: string;
  collection: CollectionGame[];
  wishlist: CollectionGame[];
  saved: CollectionGame[];
  lists: PersonalGameList[];
  reviews?: PersonalReview[];
}) {
  const [tab, setTab] = useState<LibraryTab>('collection');
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
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
  const visibleGames = sortGames(games.filter((game) => matchesCollectionFilters(game, filter, playerCount)), sort, reviews, tab === 'wishlist');

  function labelsForGame(gameId: number): string[] {
    const labels = gameMembershipLabels(gameId, collection, wishlist, saved, lists);
    return activeList ? labels.defaults : labels.custom;
  }

  function openGame(game: GameCardGame) {
    setSelected(game);
  }


  function toggleList(value: LibraryTab) {
    if (tab === value) {
      setExpanded((current) => !current);
      return;
    }
    setTab(value);
    setExpanded(true);
  }

  const listEntries: Array<{ value: LibraryTab; label: string; games: Array<CollectionGame | PersonalListGame> }> = [
    { value: 'collection', label: 'Collection', games: collection },
    { value: 'wishlist', label: 'Wishlist', games: wishlist },
    { value: 'saved', label: 'Saved', games: saved },
    ...lists.map((list) => ({ value: `list:${list.id}` as LibraryTab, label: `${list.type === 'tier' ? 'Tier: ' : ''}${list.name}`, games: list.items })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card className="sticky top-2 z-20 flex flex-col gap-2 bg-surface-raised/95 p-2 shadow-xl backdrop-blur sm:p-3">
        <Input value={filter} onChange={(event) => setFilter(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const match = bestCollectionMatch([...collection, ...wishlist, ...saved, ...lists.flatMap((list) => list.items)].filter((game) => matchesCollectionFilters(game, filter, playerCount)), filter); if (match) openGame(match); } }} placeholder="Search by title" aria-label="Search by title" />
        <CollectionViewControls playerCount={playerCount} onPlayerCountChange={setPlayerCount} sort={sort} sortOptions={(Object.entries(sortLabels) as Array<[SortMode, string]>).map(([value, label]) => ({ value, label }))} onSortChange={(value) => setSort(value as SortMode)} view={view} onViewChange={setView} />
      </Card>
      <div className="flex flex-col gap-2">
      {listEntries.map((entry) => ({ ...entry, games: entry.games.filter((game) => matchesCollectionFilters(game, filter, playerCount)) })).filter((entry) => entry.games.length > 0).map((entry) => {
        const isExpanded = expanded && tab === entry.value;
        return <CollectionListAccordion key={entry.value} label={entry.label} count={entry.games.length} expanded={isExpanded} previewGames={rankCollectionPreviewGames(entry.games, reviews, entry.value === 'wishlist' ? 'wishlistPriority' : 'userRating', entry.value)} onToggle={() => toggleList(entry.value)}>
        {tab === entry.value && <>
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
                {tierGames.map((game) => <LibraryGame key={game.id} game={game} view={view} onOpen={() => openGame(game)} listLabels={labelsForGame(game.id)} review={reviews.find((review) => review.gameId === game.id)} />)}
                {tierGames.length === 0 && <p className="self-center text-sm text-text-muted">No games in this tier.</p>}
              </div>
            </section>;
          })}
        </div>
      ) : (
        <div className={view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' : 'flex flex-col gap-3'}>
          {visibleGames.map((game) => <LibraryGame key={game.id} game={game} view={view} onOpen={() => openGame(game)} wishlistGame={tab === 'wishlist' ? game as CollectionGame : undefined} listLabels={labelsForGame(game.id)} review={reviews.find((review) => review.gameId === game.id)} />)}
        </div>
      )}
        </>}
        </CollectionListAccordion>;
      })}
      </div>

      <GameDetailsSheet game={selected} groupId={groupId} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} collectionGame={collection.find((game) => game.id === selected?.id)} wishlistGame={wishlist.find((game) => game.id === selected?.id)} savedGame={saved.find((game) => game.id === selected?.id)} lists={lists} />
    </div>
  );
}
