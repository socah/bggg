'use client';

import { DragEvent, FormEvent, ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CollectionListAccordion } from '@/components/collection-list-accordion';
import { CollectionViewControls } from '@/components/collection-view-controls';
import { WishlistPrioritySelect } from '@/components/wishlist-priority-select';
import { compareWishlistPriority, wishlistPriority } from '@/lib/wishlist-priority';
import { bestCollectionMatch, matchesCollectionFilters } from '@/lib/collection-filter';
import { GameArtwork } from '@/components/game-artwork';
import { GamePriceOverview } from '@/components/game-price-overview';
import { GamePrivateDetailsForm } from '@/components/game-private-details-form';
import { GamePickerDialog } from '@/components/game-picker-dialog';
import { UserIdentityLink } from '@/components/user-identity-link';
import { PlayLogDialog, type PlayLogDefaults } from '@/components/play-log-dialog';
import { ReviewArticle, ReviewEditor } from '@/components/review-article';
import { DisclosureChevron } from '@/components/ui/disclosure-chevron';
import { apiFetch } from '@/lib/api';
import { rankCollectionPreviewGames } from '@/lib/collection-list-preview';
import { formatDateDmy, hhmm } from '@/lib/datetime';
import { formatDuration } from '@/lib/time-interval';
import { groupDisplayName } from '@/lib/user-identity';
import type {
  BggSearchResult,
  CollectionGame,
  CollectionGameDetails,
  GameCardGame,
  GameReview,
  PersonalGameList,
  PersonalListGame,
  PersonalReview,
} from '@/lib/types';

type LibraryTab = 'collection' | 'wishlist' | 'saved' | `list:${string}`;
type ViewMode = 'compact' | 'list';
type SortMode = 'source' | 'position' | 'name' | 'rating' | 'userRating' | 'complexity' | 'depth' | 'players' | 'time' | 'year' | 'added';

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
const SORT_LABELS: Record<SortMode, string> = { source: 'Source', position: 'Position', name: 'Name', rating: 'BGG rating', userRating: 'User rating', complexity: 'Complexity', depth: 'Depth', players: 'Minimum players', time: 'Playing time', year: 'Year published', added: 'Recently added' };

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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

export function gameMembershipLabels(
  gameId: number,
  collection: CollectionGame[],
  wishlist: CollectionGame[],
  saved: CollectionGame[],
  lists: PersonalGameList[],
) {
  return {
    defaults: [
      collection.some((game) => game.id === gameId) ? 'Collection' : null,
      wishlist.some((game) => game.id === gameId) ? 'Wishlist' : null,
      saved.some((game) => game.id === gameId) ? 'Saved' : null,
    ].filter((label): label is string => Boolean(label)),
    custom: lists.filter((list) => list.items.some((game) => game.id === gameId)).map((list) => list.name),
  };
}

function GameMeta({ game, listLabels = [] }: { game: GameCardGame; listLabels?: string[] }) {
  const playerRange = game.minPlayers === game.maxPlayers ? String(game.minPlayers) : `${game.minPlayers}–${game.maxPlayers}`;
  return (
    <div className="flex flex-wrap gap-1">
      {game.minPlayers > 0 && <Badge aria-label={`${playerRange} players`}>👥 {playerRange}</Badge>}
      {game.playingTime > 0 && <Badge aria-label={`${game.playingTime} minutes`}>🕒 {game.playingTime}′</Badge>}
      {listLabels.map((label, index) => <Badge key={`${label}:${index}`} className="bg-accent-2 text-accent-2-ink">{label}</Badge>)}
    </div>
  );
}

function ReviewExcerpt({ review }: { review: PersonalReview }) {
  const scores = [
    review.rating && `${review.rating}/10`,
    review.complexityScore && `Complexity ${review.complexityScore}/5`,
    review.depthScore && `Depth ${review.depthScore}/5`,
  ].filter(Boolean).join(' · ');
  return <div className="text-xs text-text-muted">{scores && <strong className="block text-text">{scores}</strong>}{review.body && <p className="line-clamp-2 whitespace-pre-line">{review.body}</p>}</div>;
}

function AverageReviewMetrics({ rating, complexity, depth }: { rating: number | null; complexity: number | null; depth: number | null }) {
  if (rating === null && complexity === null && depth === null) return null;
  return <p className="text-xs text-text-muted"><strong className="text-text">Group avg</strong>{rating !== null && ` · ${rating}/10`}{complexity !== null && ` · Complexity ${complexity}/5`}{depth !== null && ` · Depth ${depth}/5`}</p>;
}

export function LibraryGame({
  game,
  view,
  onOpen,
  note,
  actions,
  listLabels,
  review,
  averageReview,
  wishlistGame,
}: {
  game: GameCardGame;
  view: ViewMode;
  onOpen: () => void;
  note?: ReactNode;
  actions?: ReactNode;
  listLabels?: string[];
  review?: PersonalReview;
  averageReview?: { rating: number | null; complexity: number | null; depth: number | null };
  wishlistGame?: CollectionGame;
}) {
  const priority = wishlistGame ? wishlistPriority(wishlistGame) : undefined;
  const priorityClass = priority ? `border-l-4 ${priority.accent}` : '';
  const priorityBadge = priority && <Badge className={priority.badge} title={wishlistGame?.source === 'bgg' ? 'Priority managed by BoardGameGeek' : undefined}>P{priority.value} · {priority.label}</Badge>;
  if (view === 'list') {
    return (
      <Card className={`relative flex min-h-20 items-start gap-2 p-2 transition-transform hover:-translate-y-0.5 ${priorityClass}`}>
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-start gap-3 pr-1 text-left">
          <GameArtwork game={game} className="size-20" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-lg">{game.name}</h3>
            {priorityBadge}
            <div className="mt-1"><GameMeta game={game} listLabels={listLabels} /></div>
            {game.owners && game.owners.length > 0 && <p className="mt-1 text-xs text-text-muted">Owned by {game.owners.map(groupDisplayName).join(', ')}</p>}
            {review && <div className="mt-1"><ReviewExcerpt review={review} /></div>}
            {averageReview && <div className="mt-1"><AverageReviewMetrics {...averageReview} /></div>}
            {note && <div className="mt-1 text-xs text-text-muted">{note}</div>}
          </div>
        </button>
        {actions && <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-1">{actions}</div>}
      </Card>
    );
  }

  return (
    <Card className={`relative flex h-full flex-col overflow-hidden transition-transform hover:-translate-y-0.5 ${priorityClass}`}>
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col text-left">
        <GameArtwork game={game} />
        <div className="flex flex-1 flex-col gap-1.5 p-2">
          <h3 className="line-clamp-2 font-display text-base leading-tight">{game.name}</h3>
          {priorityBadge}
          <GameMeta game={game} listLabels={listLabels} />
          {game.owners && game.owners.length > 0 && <p className="text-xs text-text-muted">Owned by {game.owners.map(groupDisplayName).join(', ')}</p>}
          {review && <div className="mt-auto"><ReviewExcerpt review={review} /></div>}
          {averageReview && <div className="mt-auto"><AverageReviewMetrics {...averageReview} /></div>}
          {note && <div className="text-xs text-text-muted">{note}</div>}
        </div>
      </button>
      {actions && <div className={wishlistGame ? 'flex flex-wrap gap-1 p-2 pt-0' : 'absolute right-1 top-1 flex flex-wrap items-center justify-end gap-1 rounded-sm bg-surface-raised/90 p-1'}>{actions}</div>}
    </Card>
  );
}

export function GameDetailsSheet({
  game,
  groupId,
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
  onReviewChanged,
}: {
  game: GameCardGame | null;
  groupId?: string;
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
  onReviewChanged?: () => void;
}) {
  const [details, setDetails] = useState<CollectionGameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);
  const [rating, setRating] = useState('');
  const [complexity, setComplexity] = useState('');
  const [depth, setDepth] = useState('');
  const [body, setBody] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState<number | 'mine'>('mine');
  const [editingReview, setEditingReview] = useState(false);
  const [targetListId, setTargetListId] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [editingPlayId, setEditingPlayId] = useState<string | null>(null);
  const historyEntry = useRef(false);
  const savedReviewPayload = useRef('');
  const closeFromHistory = useEffectEvent(() => onOpenChange(false));

  useEffect(() => {
    if (!open) return;
    historyEntry.current = true;
    window.history.pushState({ ...window.history.state, gameDetailsSheet: true }, '', window.location.href);
    function handlePopState() {
      if (!historyEntry.current) return;
      historyEntry.current = false;
      closeFromHistory();
    }
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      historyEntry.current = false;
    };
  }, [open]);

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen && historyEntry.current) {
      historyEntry.current = false;
      window.history.back();
    }
    onOpenChange(nextOpen);
  }

  async function loadDetails(currentGame: GameCardGame, preferredReview?: number | 'mine', keepEditing = false) {
    const response = await apiFetch(`/bgg-account/games/${currentGame.id}/details`, { cache: 'no-store' });
    if (!response.ok) throw new Error(await responseError(response));
    const next = (await response.json()) as CollectionGameDetails;
    setDetails(next);
    const mine = next.reviews.find((review) => review.isMine);
    const nextRating = mine?.rating ? String(mine.rating) : '';
    const nextComplexity = mine?.complexityScore ? String(mine.complexityScore) : '';
    const nextDepth = mine?.depthScore ? String(mine.depthScore) : '';
    const nextBody = mine?.body ?? '';
    savedReviewPayload.current = JSON.stringify({ rating: nextRating, complexity: nextComplexity, depth: nextDepth, body: nextBody });
    setRating(nextRating);
    setComplexity(nextComplexity);
    setDepth(nextDepth);
    setBody(nextBody);
    const longest = [...next.reviews].sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0))[0];
    setSelectedReviewId(preferredReview ?? (longest?.isMine ? 'mine' : longest?.id ?? 'mine'));
    setEditingReview(keepEditing || (!mine && !longest));
  }

  useEffect(() => {
    if (!open || !game) return;
    // Detail state belongs to the newly opened API resource.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetails(null);
    setError(null);
    setReviewSaved(false);
    setTargetListId('');
    void loadDetails(game).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load game details'));
  }, [game, open]);

  async function saveReview() {
    if (!game || (!rating && !complexity && !depth && !body.trim())) return;
    const statePayload = JSON.stringify({ rating, complexity, depth, body });
    if (statePayload === savedReviewPayload.current) return;
    setSaving(true);
    setReviewSaved(false);
    setError(null);
    try {
      const response = await apiFetch(`/bgg-account/games/${game.id}/review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(rating && { rating: Number(rating) }),
          ...(complexity && { complexityScore: Number(complexity) }),
          ...(depth && { depthScore: Number(depth) }),
          body: body.trim(),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const saved = (await response.json()) as Omit<GameReview, 'displayName' | 'nickname' | 'username' | 'profileGroupId' | 'isMine'>;
      savedReviewPayload.current = statePayload;
      setReviewSaved(true);
      setSelectedReviewId('mine');
      setDetails((current) => {
        if (!current) return current;
        const existingMine = current.reviews.find((review) => review.isMine);
        const mineView: GameReview = {
          ...saved,
          displayName: existingMine?.displayName ?? 'You',
          nickname: existingMine?.nickname ?? null,
          username: existingMine?.username ?? 'you',
          profileGroupId: existingMine?.profileGroupId ?? groupId ?? null,
          isMine: true,
        };
        return {
          ...current,
          reviews: existingMine
            ? current.reviews.map((review) => review.isMine ? mineView : review)
            : [mineView, ...current.reviews],
        };
      });
      onReviewChanged?.();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to save review');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open || !details || !game) return;
    const timer = window.setTimeout(() => { void saveReview(); }, 700);
    return () => window.clearTimeout(timer);
    // saveReview intentionally reads the latest form fields after the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, details, game, rating, complexity, depth, body]);

  async function deleteReview() {
    if (!game || !window.confirm('Delete your review?')) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch(`/bgg-account/games/${game.id}/review`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await responseError(response));
      await loadDetails(game);
      onReviewChanged?.();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete review');
    } finally {
      setSaving(false);
    }
  }

  async function addToSelectedList(selectedListId: string) {
    if (!game || !onMutate || !selectedListId) return;
    setTargetListId(selectedListId);
    const builtIn = selectedListId.startsWith('built-in:') ? selectedListId.slice('built-in:'.length) : null;
    const list = lists.find((candidate) => candidate.id === selectedListId);
    const path = builtIn === 'collection'
      ? '/bgg-account/games'
      : builtIn
        ? `/bgg-account/${builtIn}`
        : `/bgg-account/lists/${selectedListId}/games`;
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
  const selectedReview = selectedReviewId === 'mine'
    ? mine
    : details?.reviews.find((review) => review.id === selectedReviewId);
  const imported = mine?.source === 'bgg';
  const containingLists = game ? lists.filter((list) => list.items.some((item) => item.id === game.id)) : [];
  const availableLists = game ? lists.filter((list) => !list.items.some((item) => item.id === game.id)) : [];
  const hasAvailableList = !collectionGame || !wishlistGame || !savedGame || availableLists.length > 0;
  const effectivePlayDefaults = playDefaults ?? (groupId ? { groupId, playedDate: todayKey(), userIds: [] } : undefined);
  const membershipTags = game ? [
    collectionGame && {
      key: 'collection',
      label: 'Collection',
      removable: collectionGame.source === 'manual',
      remove: () => onMutate?.(`/bgg-account/games/${game.id}`, { method: 'DELETE' }, `Removed ${game.name} from collection.`),
    },
    wishlistGame && {
      key: 'wishlist',
      label: 'Wishlist',
      removable: wishlistGame.source === 'manual',
      remove: () => onMutate?.(`/bgg-account/wishlist/${game.id}`, { method: 'DELETE' }, `Removed ${game.name} from wishlist.`),
    },
    savedGame && {
      key: 'saved',
      label: 'Saved',
      removable: true,
      remove: () => onMutate?.(`/bgg-account/saved/${game.id}`, { method: 'DELETE' }, `Removed ${game.name} from Saved.`),
    },
    ...containingLists.map((list) => ({
      key: `list:${list.id}`,
      label: list.name,
      removable: true,
      remove: () => onMutate?.(`/bgg-account/lists/${list.id}/games/${game.id}`, { method: 'DELETE' }, ''),
    })),
  ].filter((tag): tag is { key: string; label: string; removable: boolean; remove: () => Promise<boolean> | undefined } => Boolean(tag)) : [];

  function reviewMembershipTags(editable: boolean) {
    if (membershipTags.length === 0 && (!editable || !hasAvailableList)) return null;
    return <div className="flex flex-wrap items-center gap-1.5" aria-label="Game lists">
      {membershipTags.map((tag) => tag.removable && editable && onMutate ? (
        <button key={tag.key} type="button" aria-label={`Remove ${tag.label} tag`} disabled={busy} onClick={() => void tag.remove()} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-accent-2 bg-accent-2/15 px-2.5 text-xs font-semibold text-text hover:border-accent disabled:opacity-50">
          {tag.label}<span aria-hidden="true">×</span>
        </button>
      ) : <span key={tag.key} title={editable && !tag.removable ? 'Managed by BoardGameGeek' : undefined} className="inline-flex min-h-7 items-center rounded-full border border-border bg-surface-raised px-2.5 text-xs font-semibold text-text-muted">{tag.label}</span>)}
      {editable && onMutate && hasAvailableList && <select aria-label="Add list tag" value={targetListId} disabled={busy} onChange={(event) => void addToSelectedList(event.target.value)} className="min-h-7 rounded-full border border-dashed border-border bg-surface px-2 text-xs text-text-muted">
        <option value="">+ Add tag</option>
        {!collectionGame && <option value="built-in:collection">Collection</option>}
        {!wishlistGame && <option value="built-in:wishlist">Wishlist</option>}
        {!savedGame && <option value="built-in:saved">Saved</option>}
        {availableLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
      </select>}
    </div>;
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent aria-describedby={undefined} className="max-h-[94vh] w-[calc(100%-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          {game && <GameArtwork game={game} className="h-20 w-16" alt={`${game.name} cover`} />}
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-display text-2xl">{game ? <a href={`https://boardgamegeek.com/boardgame/${game.bggId}`} target="_blank" rel="noreferrer" className="underline decoration-transparent underline-offset-4 hover:decoration-current">{game.name}</a> : null}</DialogTitle>
            {game && <div className="mt-1"><GameMeta game={game} /></div>}
            {game?.owners && game.owners.length > 0 && <p className="mt-1 text-xs text-text-muted">Owned by {game.owners.map((owner, index) => <span key={owner.id}>{index > 0 && ', '}<UserIdentityLink user={owner} groupId={groupId} /></span>)}</p>}
          </div>
          <DialogClose className="rounded-sm px-3 py-2 text-sm font-semibold text-text-muted">Close</DialogClose>
        </div>

        {wishlistGame && <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge className={wishlistPriority(wishlistGame).badge}>P{wishlistPriority(wishlistGame).value} · {wishlistPriority(wishlistGame).label}</Badge>
          {wishlistGame.source === 'bgg' ? <span className="text-xs text-text-muted">Change priority on BoardGameGeek, then sync.</span> : onMutate && <WishlistPrioritySelect game={wishlistGame} busy={busy} onChange={(priority) => void onMutate(`/bgg-account/wishlist/${wishlistGame.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wishlistPriority: priority }) }, '')} />}
        </div>}
        {open && game && wishlistGame && <div className="mt-4"><GamePriceOverview key={game.id} gameId={game.id} /></div>}
        {error && <p role="alert" className="mt-4 text-sm text-accent">{error}</p>}
        {!details && !error && <p className="py-12 text-center text-sm text-text-muted">Loading reviews and plays...</p>}
        {details && (
          <div className="mt-4 flex flex-col gap-5">
            {game && <GamePrivateDetailsForm key={game.id} gameId={game.id} initialDetails={details.privateDetails} />}
            <section>
              <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Choose a review">
                <button type="button" aria-pressed={selectedReviewId === 'mine'} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold ${selectedReviewId === 'mine' ? 'border-accent bg-accent text-accent-ink' : 'border-border bg-surface'}`} onClick={() => { setSelectedReviewId('mine'); setEditingReview(!mine); }}>Your review{!mine && ' · Start writing'}</button>
                {details.reviews.filter((review) => !review.isMine).sort((a, b) => (b.body?.length ?? 0) - (a.body?.length ?? 0)).map((review) => (
                  <button key={review.id} type="button" aria-pressed={selectedReviewId === review.id} className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold ${selectedReviewId === review.id ? 'border-accent-2 bg-accent-2 text-accent-2-ink' : 'border-border bg-surface'}`} onClick={() => { setSelectedReviewId(review.id); setEditingReview(false); }}>{review.nickname || review.displayName || review.username}</button>
                ))}
              </div>

              <div className="mt-2 rounded-md border border-border bg-surface p-3 sm:p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
                {selectedReviewId === 'mine' && (editingReview || !mine) ? (
                  <form onSubmit={(event) => event.preventDefault()} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h3 className="font-display text-xl">{mine ? 'Edit your review' : 'Write your review'}</h3>
                      {mine && <Button type="button" variant="secondary" onClick={() => setEditingReview(false)}>Done</Button>}
                    </div>
                    {reviewMembershipTags(true)}
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="text-xs font-semibold text-text-muted">Rating<Input type="number" min="1" max="10" step="0.1" value={rating} onChange={(event) => setRating(event.target.value)} className="mt-1 min-h-10 w-full" placeholder="1-10" /></label>
                      <label className="text-xs font-semibold text-text-muted">Complexity<select value={complexity} onChange={(event) => setComplexity(event.target.value)} className={`mt-1 w-full ${selectClass}`}><option value="">Choose</option>{WEIGHT_SCALE.map((label, index) => ({ label, value: index + 1 })).reverse().map(({ label, value }) => <option key={label} value={value}>{value} - {label}</option>)}</select></label>
                      <label className="text-xs font-semibold text-text-muted">Depth<select value={depth} onChange={(event) => setDepth(event.target.value)} className={`mt-1 w-full ${selectClass}`}><option value="">Choose</option>{WEIGHT_SCALE.map((label, index) => ({ label, value: index + 1 })).reverse().map(({ label, value }) => <option key={label} value={value}>{value} - {label}</option>)}</select></label>
                    </div>
                    {rating && <p className="text-xs text-text-muted"><strong>{rating}/10:</strong> {RATING_SCALE[Math.round(Number(rating))]}</p>}
                    <ReviewEditor body={body} plays={details.plays} onChange={setBody} />
                    <div className="flex flex-wrap items-center gap-2">
                      {mine && !imported && <Button type="button" variant="secondary" disabled={saving} onClick={() => void deleteReview()}>Delete review</Button>}
                      <span className="text-xs text-text-muted" role="status">{saving ? 'Saving review...' : reviewSaved ? 'Review saved' : 'Changes save automatically'}</span>
                    </div>
                  </form>
                ) : selectedReview ? (
                  <>
                    <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                      <div><p className="text-xs font-bold uppercase tracking-wider text-text-muted">Review by</p><h3 className="mt-1 font-display text-2xl"><UserIdentityLink user={{ id: selectedReview.userId, username: selectedReview.username, displayName: selectedReview.displayName, nickname: selectedReview.nickname }} groupId={selectedReview.profileGroupId} /></h3><p className="mt-1 text-xs text-text-muted">Updated {formatDateDmy(selectedReview.updatedAt)}{selectedReview.source === 'bgg' && ' · Rating synced from BGG'}</p></div>
                      <div className="flex flex-wrap items-center gap-2">{selectedReview.rating && <Badge>{selectedReview.rating}/10</Badge>}{selectedReview.complexityScore && <Badge>Complexity {selectedReview.complexityScore}/5</Badge>}{selectedReview.depthScore && <Badge>Depth {selectedReview.depthScore}/5</Badge>}{selectedReview.isMine && <Button type="button" variant="secondary" className="min-h-9 px-3" onClick={() => setEditingReview(true)}>Edit</Button>}</div>
                    </header>
                    {selectedReview.isMine && <div className="mb-4">{reviewMembershipTags(false)}</div>}
                    {selectedReview.body ? <ReviewArticle body={selectedReview.body} plays={details.plays} /> : <p className="py-10 text-center text-sm italic text-text-muted">This review currently contains scores only.</p>}
                  </>
                ) : null}
              </div>
            </section>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-display text-lg">Logged plays <span className="text-sm text-text-muted">({details.plays.length})</span></h3><Button type="button" className="min-h-9 px-3 text-xs" onClick={() => setLogOpen(true)}>Log a play</Button></div>
              <div className="mt-3 flex flex-col gap-2">
                {details.plays.length === 0 && <p className="text-sm text-text-muted">No logged plays in your groups.</p>}
                {details.plays.map((play) => {
                  const expanded = editingPlayId === play.id;
                  return <div id={`logged-play-${play.id}`} key={play.id} className="scroll-mt-4 overflow-hidden rounded-sm border border-border bg-surface-raised">
                    <button type="button" aria-expanded={expanded} className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-highlight" onClick={() => setEditingPlayId(expanded ? null : play.id)}>
                      <strong className="shrink-0">{formatDateDmy(play.playedAt)}</strong>
                      <span className="shrink-0 font-semibold">{play.groupName}</span>
                      {!expanded && play.notes && <span className="min-w-0 max-w-48 truncate text-xs text-text-muted">{play.notes}</span>}
                      {play.startedAt && play.endedAt && <span className="shrink-0 text-xs text-text-muted">{hhmm(play.startedAt)}–{hhmm(play.endedAt)}</span>}
                      {play.durationMinutes && <span className="shrink-0 text-xs text-text-muted">{formatDuration(play.durationMinutes)}</span>}
                      {play.status === 'abandoned' && <span className="shrink-0 text-xs font-semibold text-accent">Abandoned</span>}
                      <span className="flex-1" />
                      <DisclosureChevron expanded={expanded} />
                    </button>
                    {game && <AnimatedDisclosure expanded={expanded}><div className="border-t border-border"><PlayLogDialog inline embedded game={game} open={expanded} editPlayId={play.id} defaults={{ groupId: play.groupId, playedDate: play.playedAt.slice(0, 10), userIds: [] }} onOpenChange={(open) => { if (!open) setEditingPlayId(null); }} onLogged={() => { void loadDetails(game); onPlayLogged?.(); }} /></div></AnimatedDisclosure>}
                  </div>;
                })}
              </div>
            </section>
          </div>
        )}
        {open && game && !wishlistGame && <div className="mt-5"><GamePriceOverview key={game.id} gameId={game.id} /></div>}
      </DialogContent>
       {logOpen && <PlayLogDialog game={game} open={logOpen} defaults={effectivePlayDefaults} onOpenChange={setLogOpen} onLogged={() => { if (game) void loadDetails(game); onPlayLogged?.(); }} />}
    </Dialog>
  );
}

function sortGames(games: Array<CollectionGame | PersonalListGame>, sort: SortMode, reviews: PersonalReview[] = [], isWishlist = false) {
  const reviewByGameId = new Map(reviews.map((review) => [review.gameId, review]));
  return [...games].sort((a, b) => {
    if (isWishlist) {
      const priorityOrder = compareWishlistPriority(a, b);
      if (priorityOrder) return priorityOrder;
    }
    if (sort === 'source') return (a as CollectionGame).source.localeCompare((b as CollectionGame).source) || a.name.localeCompare(b.name);
    if (sort === 'position') return (a as PersonalListGame).position - (b as PersonalListGame).position;
    if (sort === 'rating') return b.rating - a.rating || a.name.localeCompare(b.name);
    if (sort === 'userRating' || sort === 'complexity' || sort === 'depth') {
      const field = sort === 'userRating' ? 'rating' : sort === 'complexity' ? 'complexityScore' : 'depthScore';
      return (reviewByGameId.get(b.id)?.[field] ?? -1) - (reviewByGameId.get(a.id)?.[field] ?? -1) || a.name.localeCompare(b.name);
    }
    if (sort === 'players') return a.minPlayers - b.minPlayers || a.maxPlayers - b.maxPlayers || a.name.localeCompare(b.name);
    if (sort === 'time') return a.playingTime - b.playingTime || a.name.localeCompare(b.name);
    if (sort === 'year') return b.yearPublished - a.yearPublished || a.name.localeCompare(b.name);
    if (sort === 'added') return new Date((b as CollectionGame).addedAt ?? 0).getTime() - new Date((a as CollectionGame).addedAt ?? 0).getTime();
    return a.name.localeCompare(b.name);
  });
}

interface CollectionSnapshot {
  linked: boolean;
  collection: CollectionGame[];
  wishlist: CollectionGame[];
  saved: CollectionGame[];
  lists: PersonalGameList[];
  reviews: PersonalReview[];
}

let collectionSnapshot: CollectionSnapshot | null = null;

export function PersonalCollection() {
  const [collection, setCollection] = useState<CollectionGame[]>(() => collectionSnapshot?.collection ?? []);
  const [wishlist, setWishlist] = useState<CollectionGame[]>(() => collectionSnapshot?.wishlist ?? []);
  const [saved, setSaved] = useState<CollectionGame[]>(() => collectionSnapshot?.saved ?? []);
  const [lists, setLists] = useState<PersonalGameList[]>(() => collectionSnapshot?.lists ?? []);
  const [reviews, setReviews] = useState<PersonalReview[]>(() => collectionSnapshot?.reviews ?? []);
  const [linked, setLinked] = useState<boolean | null>(() => collectionSnapshot?.linked ?? null);
  const [tab, setTab] = useState<LibraryTab>('collection');
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortMode>('name');
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
  const [renamingList, setRenamingList] = useState<PersonalGameList | null>(null);
  const [renamedListName, setRenamedListName] = useState('');
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [newTierLabel, setNewTierLabel] = useState('');
  const [tierInsertAfter, setTierInsertAfter] = useState('');
  const [draggedGameId, setDraggedGameId] = useState<number | null>(null);
  const [listGamePickerOpen, setListGamePickerOpen] = useState(false);

  async function loadGames() {
    const [accountResponse, gamesResponse, wishlistResponse, savedResponse, listsResponse, reviewsResponse] = await Promise.all([
      apiFetch('/bgg-account'),
      apiFetch('/bgg-account/games'),
      apiFetch('/bgg-account/wishlist'),
      apiFetch('/bgg-account/saved'),
      apiFetch('/bgg-account/lists'),
      apiFetch('/bgg-account/reviews'),
    ]);
    for (const response of [accountResponse, gamesResponse, wishlistResponse, savedResponse, listsResponse, reviewsResponse]) {
      if (!response.ok) throw new Error(await responseError(response));
    }
    const [{ account }, nextCollection, nextWishlist, nextSaved, nextLists, nextReviews] = await Promise.all([
      accountResponse.json() as Promise<{ account: object | null }>,
      gamesResponse.json() as Promise<CollectionGame[]>,
      wishlistResponse.json() as Promise<CollectionGame[]>,
      savedResponse.json() as Promise<CollectionGame[]>,
      listsResponse.json() as Promise<PersonalGameList[]>,
      reviewsResponse.json() as Promise<PersonalReview[]>,
    ]);
    collectionSnapshot = { linked: Boolean(account), collection: nextCollection, wishlist: nextWishlist, saved: nextSaved, lists: nextLists, reviews: nextReviews };
    setLinked(collectionSnapshot.linked);
    setCollection(nextCollection);
    setWishlist(nextWishlist);
    setSaved(nextSaved);
    setLists(nextLists);
    setReviews(nextReviews);
  }

  useEffect(() => {
    // Initial API synchronization intentionally updates state from its async callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGames().catch((reason: unknown) => {
      collectionSnapshot = null;
      setCollection([]);
      setWishlist([]);
      setSaved([]);
      setLists([]);
      setReviews([]);
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
           const next = (await response.json()) as BggSearchResult[];
           if (!controller.signal.aborted) {
             setResults(next);
             setSearchedQuery(normalized);
           }
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
      void success;
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

  async function renameList(event: FormEvent) {
    event.preventDefault();
    const name = renamedListName.trim();
    if (!renamingList || !name || name === renamingList.name) return;
    const renamed = await mutate(`/bgg-account/lists/${renamingList.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }, '');
    if (renamed) setRenamingList(null);
  }

  const activeList = tab.startsWith('list:') ? lists.find((list) => `list:${list.id}` === tab) : undefined;
  const pickerGames = [...new Map([...collection, ...wishlist, ...saved, ...lists.flatMap((list) => list.items)].map((game) => [game.id, game])).values()];
  const rawGames: Array<CollectionGame | PersonalListGame> = tab === 'collection' ? collection : tab === 'wishlist' ? wishlist : tab === 'saved' ? saved : activeList?.items ?? [];
  const hasMixedSources = !activeList && new Set((rawGames as CollectionGame[]).map((game) => game.source)).size > 1;
  const effectiveSort = sort === 'source' && !hasMixedSources ? 'name' : sort;
   const visibleGames = sortGames(rawGames.filter((game) => matchesCollectionFilters(game, query, playerCount)), activeList?.type === 'tier' ? 'position' : effectiveSort, reviews, tab === 'wishlist');

   function openSearchGame(game: GameCardGame) {
     setSearchOpen(false);
     setSelected(game);
   }

  function labelsForGame(gameId: number): string[] {
    const labels = gameMembershipLabels(gameId, collection, wishlist, saved, lists);
    return activeList ? labels.defaults : labels.custom;
  }

  function reviewForGame(gameId: number): PersonalReview | undefined {
    return reviews.find((review) => review.gameId === gameId);
  }

  function listActions(game: PersonalListGame) {
    if (!activeList || editingListId !== activeList.id) return null;
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
    setExpanded(true);
    setEditingListId(null);
  }


  async function updateTiers(tiers: string[], success: string): Promise<boolean> {
    if (!activeList) return false;
    return mutate(`/bgg-account/lists/${activeList.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiers }),
    }, success);
  }

  const listEntries: Array<{ value: LibraryTab; label: string; games: Array<CollectionGame | PersonalListGame> }> = [
    { value: 'collection', label: 'Collection', games: collection },
    { value: 'wishlist', label: 'Wishlist', games: wishlist },
    { value: 'saved', label: 'Saved', games: saved },
    ...lists.map((list) => ({ value: `list:${list.id}` as LibraryTab, label: `${list.type === 'tier' ? 'Tier: ' : ''}${list.name}`, games: list.items })),
  ];

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
      <div ref={searchContainerRef} className="sticky top-2 z-20">
      <Card className="relative flex flex-col gap-2 overflow-visible bg-surface-raised/95 p-2 shadow-xl backdrop-blur sm:p-3">
        <div className="relative">
          <Input value={query} onFocus={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); if (event.key === 'Enter') { event.preventDefault(); const match = bestCollectionMatch(pickerGames.filter((game) => matchesCollectionFilters(game, query, playerCount)), query); if (match) openSearchGame(match); } }} onChange={(event) => { const value = event.target.value; setQuery(value); setSearchOpen(true); setSearchError(null); setSearchedQuery(''); setResults([]); setSearching(false); }} className="min-h-11 w-full pr-24" placeholder="Search your lists and BoardGameGeek" aria-label="Search your lists and BoardGameGeek" />
          {searching && <span className="absolute inset-y-0 right-3 flex items-center text-xs text-text-muted">Searching...</span>}
        </div>
        {searchOpen && query.trim().length >= 2 && (results.length > 0 || searchError || (!searching && searchedQuery === query.trim())) && (
          <div className="absolute left-2 right-2 top-full mt-1 max-h-[28rem] overflow-y-auto rounded-sm border-[length:var(--border-w)] border-border bg-surface-raised shadow-xl sm:left-3 sm:right-3">
            {searchError && <p role="alert" className="p-3 text-sm text-accent">{searchError}</p>}
            {!searchError && results.length === 0 && <p className="p-3 text-sm text-text-muted">No games found.</p>}
            {results.map((result) => {
              const libraryGame = pickerGames.find((game) => game.bggId === result.bggId);
              const artwork = <>
                {result.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.thumbnail} alt="" className="size-12 shrink-0 rounded-sm object-cover" />
                ) : <div className="size-12 shrink-0 rounded-sm bg-surface" />}
                <div className="min-w-0"><strong className="block truncate">{result.name}</strong>{result.yearPublished > 0 && <span className="text-sm text-text-muted">{result.yearPublished}</span>}</div>
              </>;
              return (
              <div key={result.bggId} className="flex flex-col items-stretch justify-between gap-3 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center">
                {libraryGame ? <button type="button" aria-label={`Open details for ${result.name}`} onClick={() => openSearchGame(libraryGame)} className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-accent-2">{artwork}</button> : <div className="flex min-w-0 flex-1 items-center gap-3">{artwork}</div>}
                <div className="flex flex-wrap gap-2">
                  {(['collection', 'wishlist', 'saved'] as const).map((target) => {
                    const source = target === 'collection' ? collection : target === 'wishlist' ? wishlist : saved;
                    const active = source.some((game) => game.bggId === result.bggId);
                    return <Button key={target} type="button" variant={active ? 'primary' : 'secondary'} aria-pressed={active} className="min-h-9 px-3" disabled={busy} onClick={() => { if (!active) addGame(result.bggId, target); }}>{target === 'collection' ? 'Own' : target === 'wishlist' ? 'Wishlist' : 'Saved'}</Button>;
                  })}
                  {activeList && (() => { const active = activeList.items.some((game) => game.bggId === result.bggId); return <Button type="button" variant={active ? 'primary' : 'secondary'} aria-pressed={active} className="min-h-9 px-3" disabled={busy} onClick={() => { if (!active) void mutate(`/bgg-account/lists/${activeList.id}/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bggId: result.bggId }) }, `Added to ${activeList.name}.`); }}>{active ? `In ${activeList.name}` : `Add to ${activeList.name}`}</Button>; })()}
                </div>
              </div>
            ); })}
          </div>
        )}
        <CollectionViewControls playerCount={playerCount} onPlayerCountChange={setPlayerCount} sort={effectiveSort} sortOptions={(Object.entries(SORT_LABELS) as Array<[SortMode, string]>).filter(([value]) => value !== 'position' && (value !== 'source' || hasMixedSources)).map(([value, label]) => ({ value, label }))} onSortChange={(value) => setSort(value as SortMode)} view={view} onViewChange={setView} />
      </Card>
      </div>

      {message && <p role="status" className="text-sm text-text-muted">{message}</p>}

      <div className="flex justify-end">
        <button type="button" onClick={() => setCreateListOpen(true)} className="flex min-h-10 items-center justify-center rounded-sm border-[length:var(--border-w)] border-border px-3 text-sm font-semibold text-accent-2" aria-label="Create a game list">+ New list</button>
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

      <Dialog open={Boolean(renamingList)} onOpenChange={(open) => { if (!open) setRenamingList(null); }}>
        <DialogContent>
          <div className="flex items-center justify-between gap-3"><DialogTitle className="font-display text-xl">Rename list</DialogTitle><DialogClose className="px-2 py-1 text-sm text-text-muted">Close</DialogClose></div>
          <form onSubmit={renameList} className="mt-4 flex flex-col gap-3">
            <Input required autoFocus maxLength={100} value={renamedListName} onChange={(event) => setRenamedListName(event.target.value)} aria-label="List name" />
            <Button type="submit" disabled={busy || !renamedListName.trim() || renamedListName.trim() === renamingList?.name}>Rename</Button>
          </form>
        </DialogContent>
      </Dialog>

      {activeList && <GamePickerDialog open={listGamePickerOpen} title={`Add games to ${activeList.name}`} games={pickerGames} addedIds={new Set(activeList.items.map((game) => game.id))} onOpenChange={setListGamePickerOpen} onAdd={(game) => mutate(`/bgg-account/lists/${activeList.id}/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bggId: game.bggId }) }, '')} />}

      <div className="flex flex-col gap-2">
      {listEntries.map((entry) => ({ ...entry, games: entry.games.filter((game) => matchesCollectionFilters(game, query, playerCount)) })).filter((entry) => entry.games.length > 0).map((entry) => {
        const isExpanded = expanded && tab === entry.value;
        const entryList = entry.value.startsWith('list:') ? lists.find((list) => `list:${list.id}` === entry.value) : undefined;
        return <CollectionListAccordion key={entry.value} label={entry.label} count={entry.games.length} expanded={isExpanded} previewGames={rankCollectionPreviewGames(entry.games, reviews, entry.value === 'wishlist' ? 'wishlistPriority' : 'userRating', entry.value)} onToggle={() => { if (tab === entry.value) setExpanded((current) => !current); else changeTab(entry.value); }} actions={entryList ? <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex min-h-10 w-10 items-center justify-center rounded-sm text-lg font-bold text-text-muted hover:bg-highlight" aria-label={`${entryList.name} settings`} disabled={busy}>...</button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { const entering = editingListId !== entryList.id; setEditingListId(entering ? entryList.id : null); if (entering) { setTab(entry.value); setExpanded(true); } }}>{editingListId === entryList.id ? 'Exit edit mode' : 'Enter edit mode'}</DropdownMenuItem><DropdownMenuItem onSelect={() => { setRenamingList(entryList); setRenamedListName(entryList.name); }}>Rename list</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-accent" onSelect={() => { if (window.confirm(`Delete ${entryList.name}?`)) void mutate(`/bgg-account/lists/${entryList.id}`, { method: 'DELETE' }, '').then((deleted) => { if (deleted && tab === entry.value) { setTab('collection'); setExpanded(false); setEditingListId(null); } }); }}>Delete list</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : undefined}>
        {tab === entry.value && <>
      {activeList?.type === 'tier' && editingListId === activeList.id && (
        <Card className="p-3">
          <form onSubmit={addTier} className="flex flex-col gap-2 sm:flex-row">
            <Input required maxLength={50} value={newTierLabel} onChange={(event) => setNewTierLabel(event.target.value)} placeholder="New tier label" />
            <select value={tierInsertAfter} onChange={(event) => setTierInsertAfter(event.target.value)} className={selectClass}><option value="">Insert at top</option>{activeList.tiers.map((tier) => <option key={tier} value={tier}>Insert after {tier}</option>)}</select>
            <Button type="submit" variant="secondary" disabled={busy || !newTierLabel.trim()}>Add tier</Button>
          </form>
        </Card>
      )}

      {activeList && editingListId === activeList.id && <div className="flex justify-end"><Button type="button" variant="secondary" disabled={busy} onClick={() => setListGamePickerOpen(true)}>+ Add games</Button></div>}

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
                {tierValue !== null && editingListId === activeList.id && <>
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
                  const editing = editingListId === activeList.id;
                  return <div key={game.id} draggable={editing} onDragStart={() => { if (editing) setDraggedGameId(game.id); }} onDragEnd={() => setDraggedGameId(null)} onDragOver={(event) => { if (editing) event.preventDefault(); }} onDrop={(event) => { if (!editing) return; event.stopPropagation(); dropGame(event, tierValue, position); }} className={editing ? (draggedGameId === game.id ? 'cursor-grab opacity-50' : 'cursor-grab') : ''}><LibraryGame game={game} view={view} onOpen={() => setSelected(game)} actions={listActions(game as PersonalListGame)} listLabels={labelsForGame(game.id)} review={reviewForGame(game.id)} /></div>;
                })}
                {tierGames.length === 0 && <p className="self-center text-sm text-text-muted">Drop games here</p>}
              </div>
            </section>;
          })}
        </div>
      ) : (
        <div className={view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' : 'flex flex-col gap-3'}>
          {visibleGames.map((game) => {
            const wishlistGame = tab === 'wishlist' ? game as CollectionGame : undefined;
            const actions = wishlistGame?.source === 'manual' ? <WishlistPrioritySelect game={wishlistGame} busy={busy} onChange={(priority) => void mutate(`/bgg-account/wishlist/${game.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wishlistPriority: priority }) }, '')} /> : activeList ? listActions(game as PersonalListGame) : undefined;
            return <LibraryGame key={game.id} game={game} view={view} onOpen={() => setSelected(game)} actions={actions} wishlistGame={wishlistGame} listLabels={labelsForGame(game.id)} review={reviewForGame(game.id)} />;
          })}
        </div>
      )}
        </>}
        </CollectionListAccordion>;
      })}
      </div>

      <GameDetailsSheet game={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} collectionGame={collection.find((game) => game.id === selected?.id)} wishlistGame={wishlist.find((game) => game.id === selected?.id)} savedGame={saved.find((game) => game.id === selected?.id)} lists={lists} busy={busy} onMutate={mutate} onReviewChanged={() => { void loadGames(); }} />
    </div>
  );
}
