'use client';

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogClose, DialogSheetContent, DialogTitle } from '@/components/ui/dialog';
import { GameArtwork } from '@/components/game-artwork';
import type { GameCardGame } from '@/lib/types';

export function GamePickerDialog<T extends GameCardGame,>({
  open,
  title,
  games,
  addedIds = new Set<number>(),
  singleSelect = false,
  controls,
  loading = false,
  error,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  title: string;
  games: T[];
  addedIds?: Set<number>;
  singleSelect?: boolean;
  controls?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (game: T) => Promise<boolean> | boolean;
}) {
  const [filter, setFilter] = useState('');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [confirmedIds, setConfirmedIds] = useState(new Set<number>());
  const historyEntry = useRef(false);
  const closeFromHistory = useEffectEvent(() => onOpenChange(false));

  useEffect(() => {
    if (!open) return;
    historyEntry.current = true;
    window.history.pushState({ ...window.history.state, gamePicker: true }, '', window.location.href);
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

  const normalized = filter.trim().toLocaleLowerCase();
  const filtered = normalized ? games.filter((game) => game.name.toLocaleLowerCase().includes(normalized)) : games;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogSheetContent aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        <DialogClose className="mb-2 mt-1 block text-sm text-text-muted">Close</DialogClose>
        {controls}
        <input type="search" autoFocus placeholder="Filter by name..." value={filter} onChange={(event) => setFilter(event.target.value)} className="mb-3 w-full rounded-sm border border-border bg-surface px-2 py-2 text-sm" />
        {loading && <p className="text-sm text-text-muted">Loading games...</p>}
        {error && <p role="alert" className="text-sm text-accent">{error}</p>}
        {!loading && !error && filtered.length === 0 && <p className="text-sm text-text-muted">No games match this filter.</p>}
        <ul className="flex flex-col gap-1">
          {filtered.map((game) => {
            const added = !singleSelect && (addedIds.has(game.id) || confirmedIds.has(game.id));
            return <li key={game.id}>
              <button type="button" disabled={pendingId !== null || added} aria-pressed={singleSelect ? undefined : added} className="flex min-h-14 w-full items-center gap-3 rounded-sm bg-surface px-2 py-1.5 text-left text-sm hover:bg-highlight disabled:opacity-100" onClick={async () => {
                setPendingId(game.id);
                try {
                  if (await onAdd(game)) {
                    if (singleSelect) changeOpen(false);
                    else setConfirmedIds((current) => new Set(current).add(game.id));
                  }
                } finally { setPendingId(null); }
              }}>
                <GameArtwork game={game} className="size-11" showRating={false} />
                <span className="min-w-0 flex-1"><strong className="block truncate">{game.name}</strong>{game.minPlayers > 0 && <span className="text-xs text-text-muted">{game.minPlayers}-{game.maxPlayers} players</span>}</span>
                {!singleSelect && <span className={`shrink-0 text-lg ${added ? 'text-accent-2' : 'text-transparent'}`} aria-label={added ? 'Added' : undefined}>✅</span>}
              </button>
            </li>;
          })}
        </ul>
      </DialogSheetContent>
    </Dialog>
  );
}
