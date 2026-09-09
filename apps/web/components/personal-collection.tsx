'use client';

import { DragEvent, FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogSheetContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserIdentityLink } from '@/components/user-identity-link';
import { PlayLogDialog, type PlayLogDefaults } from '@/components/play-log-dialog';
import { DisclosureChevron } from '@/components/ui/disclosure-chevron';
import { apiFetch } from '@/lib/api';
import { formatDateDmy } from '@/lib/datetime';
import type {
  BggSearchResult,
  CollectionGame,
  CollectionGameDetails,
  GameCardGame,
  PersonalGameList,
  PersonalListGame,
} from '@/lib/types';

type LibraryTab = 'collection' | 'wishlist' | 'saved' | `list:${string}`;
type ViewMode = 'compact' | 'list';
type SortMode = 'priority' | 'source' | 'position' | 'name' | 'rating' | 'players' | 'time' | 'year' | 'added';

const WISHLIST_PRIORITIES: Record<number, string> = {
  1: 'Must have',
  2: 'Love to have',
  3: 'Like to have',
  4: 'Thinking about it',
  5: "Don't buy this",
};

const RATING_SCALE: Record<number, string> = {
  10: 'Outstanding. Always want to play and expect this will never change.',
  9: 'Excellent game. Always want to play it.',
  8: "Very good game. I like to play. Probably I'll suggest it and will never turn down a game.",
  7: 'Good game, usually willing to play.',
  6: 'Ok game, some fun or challenge at least, will play sporadically if in the right mood.',
  5: 'Average game, slightly boring, take it or leave it.',
  4: "Not so good, it doesn't get me but could be talked into it on occasion.",
  3: "Likely won't play this again although could be convinced. Bad.",
  2: "Extremely annoying game, won't play this ever again.",
  1: "Defies description of a game. You won't catch me dead playing this. Clearly broken.",
};

const WEIGHT_SCALE = ['Light', 'Medium Light', 'Medium', 'Medium Heavy', 'Heavy'];
const selectClass = 'min-h-10 rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised px-2 text-sm text-text';
const SORT_LABELS: Record<SortMode, string> = { priority: 'Wishlist priority', source: 'Source', position: 'Position', name: 'Name', rating: 'BGG rating', players: 'Minimum players', time: 'Playing time', year: 'Year published', added: 'Recently added' };

function AnimatedDisclosure({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  return <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} aria-hidden={!expanded} inert={!expanded}><div className="overflow-hidden">{children}</div></div>;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    return Array.isArray(body.message) ? body.message.join(', ') : body.message ?? 'Request failed';
  } catch {
    return 'Request failed';
  }
}

function GameMeta({ game }: { game: GameCardGame }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {game.yearPublished > 0 && <Badge>{game.yearPublished}</Badge>}
      {game.rating > 0 && <Badge>{game.rating.toFixed(1)} BGG</Badge>}
      {game.minPlayers > 0 && <Badge>{game.minPlayers}{'\u2013'}{game.maxPlayers} players</Badge>}
      {game.playingTime > 0 && <Badge>{game.playingTime} min</Badge>}
    </div>
  );
}

export function LibraryGame({
  game,
  view,
  onOpen,
  note,
  actions,
}: {
  game: GameCardGame;
  view: ViewMode;
  onOpen: () => void;
  note?: ReactNode;
  actions?: ReactNode;
}) {
  const image = game.image || game.thumbnail;
  if (view === 'list') {
    return (
      <Card className="flex min-h-24 items-center gap-3 p-3 transition-transform hover:-translate-y-0.5">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-4 text-left">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="h-20 w-20 shrink-0 rounded-sm object-cover" />
          ) : <div className="h-20 w-20 shrink-0 rounded-sm bg-surface" />}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-lg">{game.name}</h3>
            <div className="mt-2"><GameMeta game={game} /></div>
            {game.owners && game.owners.length > 0 && <p className="mt-2 text-xs text-text-muted">Owned by {game.owners.map((owner) => owner.displayName || owner.username).join(', ')}</p>}
            {note && <div className="mt-2 text-xs text-text-muted">{note}</div>}
          </div>
        </button>
        {actions && <div className="flex shrink-0 flex-col items-end gap-2">{actions}</div>}
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden transition-transform hover:-translate-y-0.5">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="aspect-[4/3] w-full object-cover" />
        ) : <div className="aspect-[4/3] w-full bg-surface" />}
        <div className="flex flex-1 flex-col gap-2 p-3">
          <h3 className="line-clamp-2 font-display text-base leading-tight">{game.name}</h3>
          <GameMeta game={game} />
          {game.owners && game.owners.length > 0 && <p className="text-xs text-text-muted">Owned by {game.owners.map((owner) => owner.displayName || owner.username).join(', ')}</p>}
          {note && <div className="mt-auto pt-1 text-xs text-text-muted">{note}</div>}
        </div>
      </button>
      {actions && <div className="flex flex-wrap items-center gap-2 border-t border-border p-2">{actions}</div>}
    </Card>
  );
}

export function GameDetailsSheet({
  game,
  open,
  onOpenChange,
  collectionGame,
  wishlistGame,
  savedGame,
  lists = [],
  busy = false,
  onMutate,
  playDefaults,
  onPlayLogged,
}: {
  game: GameCardGame | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionGame?: CollectionGame;
  wishlistGame?: CollectionGame;
  savedGame?: CollectionGame;
  lists?: PersonalGameList[];
  busy?: boolean;
  onMutate?: (path: string, init: RequestInit, success: string) => Promise<boolean>;
  playDefaults?: PlayLogDefaults;
  onPlayLogged?: () => void;
}) {
  const [details, setDetails] = useState<CollectionGameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rating, setRating] = useState('');
  const [complexity, setComplexity] = useState('');
  const [depth, setDepth] = useState('');
  const [body, setBody] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [editingPlayId, setEditingPlayId] = useState<string | null>(null);

  async function loadDetails(currentGame: GameCardGame) {
    const response = await apiFetch(`/bgg-account/games/${currentGame.id}/details`, { cache: 'no-store' });
    if (!response.ok) throw new Error(await responseError(response));
    const next = (await response.json()) as CollectionGameDetails;
    setDetails(next);
    const mine = next.reviews.find((review) => review.isMine);
    setRating(mine?.rating ? String(mine.rating) : '');
    setComplexity(mine?.complexityScore ? String(mine.complexityScore) : '');
    setDepth(mine?.depthScore ? String(mine.depthScore) : '');
    setBody(mine?.body ?? '');
  }

  useEffect(() => {
    if (!open || !game) return;
    // Detail state belongs to the newly opened API resource.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetails(null);
    setError(null);
    void loadDetails(game).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load game details'));
  }, [game, open]);

  async function saveReview(event: FormEvent) {
    event.preventDefault();
    if (!game || !rating) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/bgg-account/games/${game.id}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: Number(rating),
          ...(complexity && { complexityScore: Number(complexity) }),
          ...(depth && { depthScore: Number(depth) }),
          body: body.trim(),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      await loadDetails(game);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to save review');
    } finally {
      setSaving(false);
    }
  }

  async function deleteReview() {
    if (!game || !window.confirm('Delete your review?')) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/bgg-account/games/${game.id}/review`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await responseError(response));
      await loadDetails(game);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete review');
    } finally {
      setSaving(false);
    }
  }

  async function addToSelectedList() {
    if (!game || !onMutate || !targetListId) return;
    const builtIn = targetListId.startsWith('built-in:') ? targetListId.slice('built-in:'.length) : null;
    const list = lists.find((candidate) => candidate.id === targetListId);
    const path = builtIn === 'collection'
      ? '/bgg-account/games'
      : builtIn
        ? `/bgg-account/${builtIn}`
        : `/bgg-account/lists/${targetListId}/games`;
    const label = builtIn === 'collection' ? 'Collection' : builtIn === 'wishlist' ? 'Wishlist' : builtIn === 'saved' ? 'Saved' : list?.name;
    if (!label) return;
    const added = await onMutate(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bggId: game.bggId }),
    }, `Added ${game.name} to ${label}.`);
    if (added) setTargetListId('');
  }

  const mine = details?.reviews.find((review) => review.isMine);
  const imported = mine?.source === 'bgg';
  const containingLists = game ? lists.filter((list) => list.items.some((item) => item.id === game.id)) : [];
  const availableLists = game ? lists.filter((list) => !list.items.some((item) => item.id === game.id)) : [];
  const hasAvailableList = !collectionGame || !wishlistGame || !savedGame || availableLists.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSheetContent className="w-full sm:w-[36rem] sm:max-w-[90vw]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle className="font-display text-2xl">{game?.name}</DialogTitle>
            {game && <p className="mt-1 text-sm text-text-muted">BGG rating {game.rating.toFixed(1)}</p>}
          </div>
          <DialogClose className="rounded-sm px-3 py-2 text-sm font-semibold text-text-muted">Close</DialogClose>
        </div>

        {error && <p role="alert" className="mt-4 text-sm text-accent">{error}</p>}
        {!details && !error && <p className="py-12 text-center text-sm text-text-muted">Loading reviews and plays...</p>}
        {details && (
          <div className="mt-6 flex flex-col gap-7">
            {game?.owners && game.owners.length > 0 && (
              <section>
                <h3 className="font-display text-lg">Owned by</h3>
                <p className="mt-2 text-sm">{game.owners.map((owner) => owner.displayName || owner.username).join(', ')}</p>
              </section>
            )}
            <section>
              <h3 className="font-display text-lg">Your review</h3>
              <form onSubmit={saveReview} className="mt-3 flex flex-col gap-3">
                  {mine && <p className="text-xs text-text-muted">Editing your existing review.{imported && ' The rating is updated from BGG when you sync; your other edits stay here.'}</p>}
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="text-xs font-semibold text-text-muted">Rating
                      <Input required type="number" min="1" max="10" step="0.1" value={rating} onChange={(event) => setRating(event.target.value)} className="mt-1 min-h-10 w-full" placeholder="1-10" />
                    </label>
                    <label className="text-xs font-semibold text-text-muted">Complexity
                      <select value={complexity} onChange={(event) => setComplexity(event.target.value)} className={`mt-1 w-full ${selectClass}`}>
                        <option value="">Choose</option>{WEIGHT_SCALE.map((label, index) => ({ label, value: index + 1 })).reverse().map(({ label, value }) => <option key={label} value={value}>{value} - {label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-semibold text-text-muted">Depth
                      <select value={depth} onChange={(event) => setDepth(event.target.value)} className={`mt-1 w-full ${selectClass}`}>
                        <option value="">Choose</option>{WEIGHT_SCALE.map((label, index) => ({ label, value: index + 1 })).reverse().map(({ label, value }) => <option key={label} value={value}>{value} - {label}</option>)}
                      </select>
                    </label>
                  </div>
                  {rating && <p className="text-xs text-text-muted"><strong>{rating}/10:</strong> {RATING_SCALE[Math.round(Number(rating))]}</p>}
                  <label className="text-xs font-semibold text-text-muted">Comment
                    <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} maxLength={5000} className="mt-1 w-full resize-y rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised p-2 font-body text-sm text-text" placeholder="What did you think?" />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={saving || !rating}>{saving ? 'Saving...' : mine ? 'Update review' : 'Save review'}</Button>
                    {mine && !imported && <Button type="button" variant="secondary" disabled={saving} onClick={() => void deleteReview()}>Delete review</Button>}
                  </div>
              </form>
            </section>

            {onMutate && game && (
              <section>
                <h3 className="font-display text-lg">Additional info</h3>
                <Card className="mt-3 flex flex-col gap-4 p-4">
                  <div>
                    <p className="text-xs font-semibold text-text-muted">Included in</p>
                    <div className="mt-2 flex flex-col divide-y divide-border">
                  {collectionGame && (
                    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
                      <p className="text-sm font-semibold">Collection</p>
                      {collectionGame.source === 'manual'
                        ? <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy} onClick={() => void onMutate(`/bgg-account/games/${game.id}`, { method: 'DELETE' }, `Removed ${game.name} from collection.`)}>Remove</Button>
                        : <span className="max-w-52 text-right text-xs text-text-muted">Remove on BGG, then sync</span>}
                    </div>
                  )}
                  {wishlistGame && (
                    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
                      {wishlistGame.source === 'manual' ? (
                        <>
                          <label className="text-sm font-semibold">Wishlist
                            <select aria-label={`Wishlist status for ${game.name}`} value={wishlistGame.wishlistPriority ?? 3} disabled={busy} className={`ml-2 ${selectClass}`} onChange={(event) => void onMutate(`/bgg-account/wishlist/${game.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wishlistPriority: Number(event.target.value) }) }, `Updated ${game.name}.`)}>{Object.entries(WISHLIST_PRIORITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                          </label>
                          <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy} onClick={() => void onMutate(`/bgg-account/wishlist/${game.id}`, { method: 'DELETE' }, `Removed ${game.name} from wishlist.`)}>Remove</Button>
                        </>
                      ) : (
                        <><p className="text-sm font-semibold">Wishlist · {WISHLIST_PRIORITIES[wishlistGame.wishlistPriority ?? 3]}</p><span className="max-w-52 text-right text-xs text-text-muted">Change on BGG, then sync</span></>
                      )}
                    </div>
                  )}
                  {savedGame && (
                    <div className="flex min-h-11 items-center justify-between gap-2 py-2">
                      <p className="text-sm font-semibold">Saved</p>
                      <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy} onClick={() => void onMutate(`/bgg-account/saved/${game.id}`, { method: 'DELETE' }, `Removed ${game.name} from Saved.`)}>Remove</Button>
                    </div>
                  )}
                  {containingLists.map((list) => (
                    <div key={list.id} className="flex min-h-11 items-center justify-between gap-2 py-2">
                      <p className="text-sm font-semibold">{list.name}{list.type === 'tier' && <span className="ml-1 font-normal text-text-muted">· Tier list</span>}</p>
                      <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy} onClick={() => void onMutate(`/bgg-account/lists/${list.id}/games/${game.id}`, { method: 'DELETE' }, '')}>Remove</Button>
                    </div>
                  ))}
                  {!collectionGame && !wishlistGame && !savedGame && containingLists.length === 0 && <p className="py-2 text-sm text-text-muted">Not included in a list yet.</p>}
                    </div>
                  </div>
                  {hasAvailableList && (
                    <div>
                      <p className="text-xs font-semibold text-text-muted">Add to a list</p>
                      <div className="mt-1 flex gap-2">
                        <select value={targetListId} onChange={(event) => setTargetListId(event.target.value)} className={`min-w-0 flex-1 ${selectClass}`}>
                          <option value="">Choose a list</option>
                          {!collectionGame && <option value="built-in:collection">Collection</option>}
                          {!wishlistGame && <option value="built-in:wishlist">Wishlist</option>}
                          {!savedGame && <option value="built-in:saved">Saved</option>}
                          {availableLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
                        </select>
                        <Button type="button" disabled={busy || !targetListId} onClick={() => void addToSelectedList()}>Add</Button>
                      </div>
                    </div>
                  )}
                </Card>
              </section>
            )}

            <section>
              <h3 className="font-display text-lg">Group reviews <span className="text-sm text-text-muted">({details.reviews.length})</span></h3>
              <div className="mt-3 flex flex-col gap-3">
                {details.reviews.length === 0 && <p className="text-sm text-text-muted">No reviews yet.</p>}
                {details.reviews.map((review) => (
                  <Card key={review.id} className="p-3">
                    <div className="flex items-center justify-between gap-2"><strong><UserIdentityLink user={{ id: review.userId, username: review.username, displayName: review.displayName }} groupId={review.profileGroupId} /></strong>{review.rating && <Badge>{review.rating}/10</Badge>}</div>
                    <p className="mt-1 text-xs text-text-muted">{review.source === 'bgg' ? 'Rating synced from BGG' : `Complexity ${review.complexityScore ?? '-'} / 5 · Depth ${review.depthScore ?? '-'} / 5`}</p>
                    {review.body && <p className="mt-2 whitespace-pre-wrap text-sm">{review.body}</p>}
                  </Card>
                ))}
              </div>
            </section>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg">Logged plays <span className="text-sm text-text-muted">({details.plays.length})</span></h3><Button type="button" className="min-h-9 px-3 text-xs" onClick={() => setLogOpen(true)}>Log a play</Button></div>
              <div className="mt-3 flex flex-col gap-2">
                {details.plays.length === 0 && <p className="text-sm text-text-muted">No logged plays in your groups.</p>}
                {details.plays.map((play) => {
                  const expanded = editingPlayId === play.id;
                  return <div key={play.id} className="overflow-hidden rounded-sm border border-border bg-surface-raised">
                    <button type="button" disabled={!play.canEdit} aria-expanded={expanded} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-highlight disabled:cursor-default" onClick={() => setEditingPlayId(expanded ? null : play.id)}>
                      <strong className="shrink-0">{formatDateDmy(play.playedAt)}</strong>
                      <span className="shrink-0 font-semibold">{expanded ? 'Play details' : play.groupName}</span>
                      {!expanded && play.notes && <span className="min-w-0 max-w-48 truncate text-xs text-text-muted">{play.notes}</span>}
                      {play.durationMinutes && <span className="shrink-0 text-xs text-text-muted">{play.durationMinutes} min</span>}
                      {play.status === 'abandoned' && <span className="shrink-0 text-xs font-semibold text-accent">Abandoned</span>}
                      <span className="flex-1" />
                      {play.canEdit && <DisclosureChevron expanded={expanded} />}
                    </button>
                    {game && <AnimatedDisclosure expanded={expanded}><div className="border-t border-border"><PlayLogDialog inline embedded game={game} open={expanded} editPlayId={play.id} defaults={{ groupId: play.groupId, playedDate: play.playedAt.slice(0, 10), userIds: [] }} onOpenChange={(open) => { if (!open) setEditingPlayId(null); }} onLogged={() => { void loadDetails(game); onPlayLogged?.(); }} /></div></AnimatedDisclosure>}
                  </div>;
                })}
              </div>
            </section>
          </div>
        )}
      </DialogSheetContent>
       {logOpen && <PlayLogDialog game={game} open={logOpen} defaults={playDefaults} onOpenChange={setLogOpen} onLogged={() => { if (game) void loadDetails(game); onPlayLogged?.(); }} />}
    </Dialog>
  );
}

function sortGames(games: Array<CollectionGame | PersonalListGame>, sort: SortMode) {
  return [...games].sort((a, b) => {
    if (sort === 'priority') return ((a as CollectionGame).wishlistPriority ?? 99) - ((b as CollectionGame).wishlistPriority ?? 99) || a.name.localeCompare(b.name);
    if (sort === 'source') return (a as CollectionGame).source.localeCompare((b as CollectionGame).source) || a.name.localeCompare(b.name);
    if (sort === 'position') return (a as PersonalListGame).position - (b as PersonalListGame).position;
    if (sort === 'rating') return b.rating - a.rating || a.name.localeCompare(b.name);
    if (sort === 'players') return a.minPlayers - b.minPlayers || a.maxPlayers - b.maxPlayers || a.name.localeCompare(b.name);
    if (sort === 'time') return a.playingTime - b.playingTime || a.name.localeCompare(b.name);
    if (sort === 'year') return b.yearPublished - a.yearPublished || a.name.localeCompare(b.name);
    if (sort === 'added') return new Date((b as CollectionGame).addedAt ?? 0).getTime() - new Date((a as CollectionGame).addedAt ?? 0).getTime();
    return a.name.localeCompare(b.name);
  });
}

export function PersonalCollection() {
  const [collection, setCollection] = useState<CollectionGame[]>([]);
  const [wishlist, setWishlist] = useState<CollectionGame[]>([]);
  const [saved, setSaved] = useState<CollectionGame[]>([]);
  const [lists, setLists] = useState<PersonalGameList[]>([]);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [tab, setTab] = useState<LibraryTab>('collection');
  const [view, setView] = useState<ViewMode>('compact');
  const [sort, setSort] = useState<SortMode>('name');
  const [filter, setFilter] = useState('');
  const [playerCount, setPlayerCount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BggSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<GameCardGame | null>(null);
  const [newListName, setNewListName] = useState('');
  const [newListType, setNewListType] = useState<'custom' | 'tier'>('custom');
  const [tierLabels, setTierLabels] = useState('S, A, B, C, D');
  const [createListOpen, setCreateListOpen] = useState(false);
  const [newTierLabel, setNewTierLabel] = useState('');
  const [tierInsertAfter, setTierInsertAfter] = useState('');
  const [draggedGameId, setDraggedGameId] = useState<number | null>(null);

  async function loadGames() {
    const [accountResponse, gamesResponse, wishlistResponse, savedResponse, listsResponse] = await Promise.all([
      apiFetch('/bgg-account'),
      apiFetch('/bgg-account/games'),
      apiFetch('/bgg-account/wishlist'),
      apiFetch('/bgg-account/saved'),
      apiFetch('/bgg-account/lists'),
    ]);
    for (const response of [accountResponse, gamesResponse, wishlistResponse, savedResponse, listsResponse]) {
      if (!response.ok) throw new Error(await responseError(response));
    }
    const { account } = (await accountResponse.json()) as { account: object | null };
    setLinked(Boolean(account));
    setCollection((await gamesResponse.json()) as CollectionGame[]);
    setWishlist((await wishlistResponse.json()) as CollectionGame[]);
    setSaved((await savedResponse.json()) as CollectionGame[]);
    setLists((await listsResponse.json()) as PersonalGameList[]);
  }

  useEffect(() => {
    // Initial API synchronization intentionally updates state from its async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGames().catch((reason: unknown) => {
      setMessage(reason instanceof Error ? reason.message : 'Unable to load your games');
      setLinked(false);
    });
  }, []);

  useEffect(() => {
    async function synced(event: Event) {
      setMessage((event as CustomEvent<string>).detail);
      try {
        await loadGames();
      } catch (reason) {
        setMessage(reason instanceof Error ? reason.message : 'Synced BGG, but could not refresh your games');
      }
    }
    function failed(event: Event) {
      setMessage((event as CustomEvent<string>).detail);
    }
    window.addEventListener('bgg-collection-synced', synced);
    window.addEventListener('bgg-collection-sync-failed', failed);
    return () => {
      window.removeEventListener('bgg-collection-synced', synced);
      window.removeEventListener('bgg-collection-sync-failed', failed);
    };
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void apiFetch(`/bgg-account/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(await responseError(response));
          setResults((await response.json()) as BggSearchResult[]);
          setSearchedQuery(normalized);
        })
        .catch((reason: unknown) => {
          if (!controller.signal.aborted) {
            setResults([]);
            setSearchedQuery(normalized);
            setSearchError(reason instanceof Error ? reason.message : 'Unable to search BGG');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function closeSearch(event: PointerEvent) {
      if (!searchContainerRef.current?.contains(event.target as Node)) setSearchOpen(false);
    }
    document.addEventListener('pointerdown', closeSearch);
    return () => document.removeEventListener('pointerdown', closeSearch);
  }, []);

  async function mutate(path: string, init: RequestInit, success: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiFetch(path, init);
      if (!response.ok) throw new Error(await responseError(response));
      await loadGames();
      setMessage(success || null);
      return true;
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Unable to update your games');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function addGame(bggId: number, target: 'collection' | 'wishlist' | 'saved') {
    void mutate(`/bgg-account/${target === 'collection' ? 'games' : target}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bggId }),
    }, `Added to ${target}.`);
  }

  async function createList(event: FormEvent) {
    event.preventDefault();
    const tiers = tierLabels.split(',').map((tier) => tier.trim()).filter(Boolean);
    const created = await mutate('/bgg-account/lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newListName.trim(), type: newListType, ...(newListType === 'tier' && { tiers }) }),
    }, `Created ${newListType} list.`);
    if (created) {
      setNewListName('');
      setCreateListOpen(false);
    }
  }

  const activeList = tab.startsWith('list:') ? lists.find((list) => `list:${list.id}` === tab) : undefined;
  const rawGames: Array<CollectionGame | PersonalListGame> = tab === 'collection' ? collection : tab === 'wishlist' ? wishlist : tab === 'saved' ? saved : activeList?.items ?? [];
  const hasMixedSources = !activeList && new Set((rawGames as CollectionGame[]).map((game) => game.source)).size > 1;
  const effectiveSort = (sort === 'priority' && tab !== 'wishlist') || (sort === 'source' && !hasMixedSources) ? 'name' : sort;
  const visibleGames = sortGames(rawGames.filter((game) => {
    const matchesName = game.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
    const count = Number(playerCount);
    const matchesPlayers = !count || (game.minPlayers <= count && game.maxPlayers >= count);
    return matchesName && matchesPlayers;
  }), activeList?.type === 'tier' ? 'position' : effectiveSort);

  function listActions(game: PersonalListGame) {
    if (!activeList) return null;
    return (
      <>
        {activeList.type === 'tier' && (
          <select aria-label={`Tier for ${game.name}`} value={game.tier ?? ''} disabled={busy} className={selectClass} onChange={(event) => void mutate(`/bgg-account/lists/${activeList.id}/games/${game.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: event.target.value || null }),
          }, `Moved ${game.name}.`)}>
            <option value="">Unranked</option>{activeList.tiers.map((tier) => <option key={tier}>{tier}</option>)}
          </select>
        )}
        <Button type="button" variant="secondary" className="min-h-9 px-2" disabled={busy} onClick={() => void mutate(`/bgg-account/lists/${activeList.id}/games/${game.id}`, { method: 'DELETE' }, '')}>Remove</Button>
      </>
    );
  }

  function changeTab(value: LibraryTab) {
    setTab(value);
    if (sort === 'priority' && value !== 'wishlist') setSort('name');
  }

  function changePlayerCount(delta: number) {
    const current = Number(playerCount) || 0;
    const next = current + delta;
    setPlayerCount(next > 0 ? String(next) : '');
  }

  async function updateTiers(tiers: string[], success: string): Promise<boolean> {
    if (!activeList) return false;
    return mutate(`/bgg-account/lists/${activeList.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiers }),
    }, success);
  }

  function addTier(event: FormEvent) {
    event.preventDefault();
    const label = newTierLabel.trim();
    if (!activeList || !label || activeList.tiers.includes(label)) return;
    const tiers = [...activeList.tiers];
    const insertAt = tierInsertAfter ? tiers.indexOf(tierInsertAfter) + 1 : 0;
    tiers.splice(insertAt, 0, label);
    void updateTiers(tiers, `Added tier ${label}.`).then((added) => { if (added) setNewTierLabel(''); });
  }

  function dropGame(event: DragEvent, tier: string | null, position: number) {
    event.preventDefault();
    if (!activeList || draggedGameId === null) return;
    const game = activeList.items.find((item) => item.id === draggedGameId);
    if (!game) return;
    setDraggedGameId(null);
    void mutate(`/bgg-account/lists/${activeList.id}/games/${game.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, position }),
    }, `Moved ${game.name}.`);
  }

  if (linked === null) return <p className="py-12 text-center text-sm text-text-muted">Loading collection...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div ref={searchContainerRef} className="relative z-20">
      <Card className="overflow-visible p-4">
        <div className="relative">
          <Input value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => { const value = event.target.value; setQuery(value); setSearchOpen(true); setSearchError(null); setSearchedQuery(''); if (value.trim().length < 2) { setResults([]); setSearching(false); } }} className="min-h-11 w-full pr-24" placeholder="Search BoardGameGeek for a game" aria-label="Search BoardGameGeek for a game" />
          {searching && <span className="absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">Searching...</span>}
        </div>
        {searchOpen && query.trim().length >= 2 && (results.length > 0 || searchError || (!searching && searchedQuery === query.trim())) && (
          <div className="absolute left-4 right-4 top-full mt-2 max-h-[28rem] overflow-y-auto rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised shadow-xl">
            {searchError && <p role="alert" className="p-3 text-sm text-accent">{searchError}</p>}
            {!searchError && results.length === 0 && <p className="p-3 text-sm text-text-muted">No games found.</p>}
            {results.map((result) => (
              <div key={result.bggId} className="flex flex-col items-stretch justify-between gap-3 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  {result.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.thumbnail} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
                  ) : <div className="size-12 shrink-0 rounded-sm bg-surface" />}
                  <div className="min-w-0"><strong className="block truncate">{result.name}</strong>{result.yearPublished > 0 && <span className="text-sm text-text-muted">{result.yearPublished}</span>}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="min-h-9 px-3" disabled={busy} onClick={() => addGame(result.bggId, 'collection')}>Own</Button>
                  <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy} onClick={() => addGame(result.bggId, 'wishlist')}>Wishlist</Button>
                  <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy} onClick={() => addGame(result.bggId, 'saved')}>Save</Button>
                  {activeList && <Button type="button" variant="secondary" className="min-h-9 px-3" disabled={busy} onClick={() => void mutate(`/bgg-account/lists/${activeList.id}/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bggId: result.bggId }) }, `Added to ${activeList.name}.`)}>Add to {activeList.name}</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      </div>

      {message && <p role="status" className="text-sm text-text-muted">{message}</p>}

      <div className="flex items-center overflow-x-auto border-b border-border">
        <Tabs value={tab} onValueChange={(value) => changeTab(value as LibraryTab)}>
          <TabsList>
            <TabsTrigger value="collection">Collection ({collection.length})</TabsTrigger>
            <TabsTrigger value="wishlist">Wishlist ({wishlist.length})</TabsTrigger>
            <TabsTrigger value="saved">Saved ({saved.length})</TabsTrigger>
            {lists.map((list) => <TabsTrigger key={list.id} value={`list:${list.id}`}>{list.type === 'tier' ? 'Tier: ' : ''}{list.name} ({list.items.length})</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <button type="button" onClick={() => setCreateListOpen(true)} className="mx-2 flex size-9 shrink-0 items-center justify-center rounded-sm border-[length:var(--border-w)] border-border text-xl font-semibold text-accent-2" aria-label="Create a game list">+</button>
        {activeList && <Button type="button" variant="secondary" className="ml-auto min-h-9 shrink-0 px-3" disabled={busy} onClick={() => { if (window.confirm(`Delete ${activeList.name}?`)) void mutate(`/bgg-account/lists/${activeList.id}`, { method: 'DELETE' }, `Deleted ${activeList.name}.`).then((deleted) => { if (deleted) setTab('collection'); }); }}>Delete list</Button>}
      </div>

      <Dialog open={createListOpen} onOpenChange={setCreateListOpen}>
        <DialogContent>
          <div className="flex items-center justify-between gap-3"><DialogTitle className="font-display text-xl">Create a game list</DialogTitle><DialogClose className="px-2 py-1 text-sm text-text-muted">Close</DialogClose></div>
          <form onSubmit={createList} className="mt-4 flex flex-col gap-3">
            <Input required maxLength={100} value={newListName} onChange={(event) => setNewListName(event.target.value)} placeholder="List name" />
            <select value={newListType} onChange={(event) => setNewListType(event.target.value as typeof newListType)} className={selectClass}><option value="custom">Custom list</option><option value="tier">Tier list</option></select>
            {newListType === 'tier' && <label className="text-xs font-semibold text-text-muted">Tier labels, highest to lowest<Input value={tierLabels} onChange={(event) => setTierLabels(event.target.value)} className="mt-1" placeholder="S, A, B, C, D" /></label>}
            <Button type="submit" disabled={busy}>Create list</Button>
          </form>
        </DialogContent>
      </Dialog>

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
            <select aria-label="Sort by" value={`display:${effectiveSort}`} onChange={(event) => setSort(event.target.value as SortMode)} className={selectClass}>
              <option value={`display:${effectiveSort}`} hidden>Sort by: {SORT_LABELS[effectiveSort]}</option>
              {tab === 'wishlist' && <option value="priority">Wishlist priority</option>}{hasMixedSources && <option value="source">Source</option>}<option value="name">Name</option><option value="rating">BGG rating</option><option value="players">Minimum players</option><option value="time">Playing time</option><option value="year">Year published</option><option value="added">Recently added</option>
            </select>
          </label>
          <div className="flex min-h-10 self-end overflow-hidden rounded-sm border-[length:var(--border-w)] border-border" aria-label="View style">
            <button type="button" aria-pressed={view === 'compact'} onClick={() => setView('compact')} className={`flex-1 px-3 text-sm font-semibold ${view === 'compact' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>Grid</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`flex-1 border-l border-border px-3 text-sm font-semibold ${view === 'list' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>List</button>
          </div>
        </div>
      </Card>

      {activeList?.type === 'tier' && (
        <Card className="p-4">
          <form onSubmit={addTier} className="flex flex-col gap-2 sm:flex-row">
            <Input required maxLength={50} value={newTierLabel} onChange={(event) => setNewTierLabel(event.target.value)} placeholder="New tier label" />
            <select value={tierInsertAfter} onChange={(event) => setTierInsertAfter(event.target.value)} className={selectClass}><option value="">Insert at top</option>{activeList.tiers.map((tier) => <option key={tier} value={tier}>Insert after {tier}</option>)}</select>
            <Button type="submit" variant="secondary" disabled={busy || !newTierLabel.trim()}>Add tier</Button>
          </form>
        </Card>
      )}

      {visibleGames.length === 0 && activeList?.type !== 'tier' ? (
        <Card className="p-8 text-center text-sm text-text-muted">No games match this view.</Card>
      ) : activeList?.type === 'tier' ? (
        <div className="flex flex-col gap-5">
          {[...activeList.tiers, 'Unranked'].map((tier, tierIndex) => {
            const tierValue = tier === 'Unranked' ? null : tier;
            const allTierGames = activeList.items.filter((game) => game.tier === tierValue).sort((a, b) => a.position - b.position);
            const tierGames = visibleGames.filter((game) => (game as PersonalListGame).tier === tierValue);
            return <section key={tier} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2" onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropGame(event, tierValue, allTierGames.length)}>
              <div className="flex flex-col items-center justify-start gap-1 rounded-sm bg-surface p-2 text-center">
                <h3 className="break-all font-display text-lg leading-tight">{tier}</h3>
                {tierValue !== null && <>
                  <div className="flex">
                    <button type="button" disabled={busy || tierIndex === 0} onClick={() => { const tiers = [...activeList.tiers]; [tiers[tierIndex - 1], tiers[tierIndex]] = [tiers[tierIndex], tiers[tierIndex - 1]]; void updateTiers(tiers, `Moved tier ${tier}.`); }} className="size-7 text-lg text-text-muted disabled:opacity-30" aria-label={`Move ${tier} tier up`} title="Move up">&uarr;</button>
                    <button type="button" disabled={busy || tierIndex === activeList.tiers.length - 1} onClick={() => { const tiers = [...activeList.tiers]; [tiers[tierIndex], tiers[tierIndex + 1]] = [tiers[tierIndex + 1], tiers[tierIndex]]; void updateTiers(tiers, `Moved tier ${tier}.`); }} className="size-7 text-lg text-text-muted disabled:opacity-30" aria-label={`Move ${tier} tier down`} title="Move down">&darr;</button>
                  </div>
                  <button type="button" disabled={busy || activeList.tiers.length === 1} onClick={() => { if (window.confirm(`Delete tier ${tier}? Its games will become unranked.`)) void updateTiers(activeList.tiers.filter((candidate) => candidate !== tier), `Deleted tier ${tier}.`); }} className="size-7 text-xl text-accent disabled:opacity-30" aria-label={`Delete ${tier} tier`} title="Delete tier">&times;</button>
                </>}
              </div>
              <div className={`${view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'flex flex-col gap-3'} min-h-20 rounded-sm border border-dashed border-border p-2`}>
                {tierGames.map((game) => {
                  const position = allTierGames.findIndex((candidate) => candidate.id === game.id);
                  return <div key={game.id} draggable onDragStart={() => setDraggedGameId(game.id)} onDragEnd={() => setDraggedGameId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.stopPropagation(); dropGame(event, tierValue, position); }} className={draggedGameId === game.id ? 'opacity-50' : 'cursor-grab'}><LibraryGame game={game} view={view} onOpen={() => setSelected(game)} actions={listActions(game as PersonalListGame)} /></div>;
                })}
                {tierGames.length === 0 && <p className="self-center text-sm text-text-muted">Drop games here</p>}
              </div>
            </section>;
          })}
        </div>
      ) : (
        <div className={view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' : 'flex flex-col gap-3'}>
          {visibleGames.map((game) => {
            return <LibraryGame key={game.id} game={game} view={view} onOpen={() => setSelected(game)} actions={activeList ? listActions(game as PersonalListGame) : undefined} />;
          })}
        </div>
      )}

      <GameDetailsSheet game={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} collectionGame={collection.find((game) => game.id === selected?.id)} wishlistGame={wishlist.find((game) => game.id === selected?.id)} savedGame={saved.find((game) => game.id === selected?.id)} lists={lists} busy={busy} onMutate={mutate} />
    </div>
  );
}
