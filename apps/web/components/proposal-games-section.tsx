'use client';

import { useMemo, useState } from 'react';
import type { ProposalStatus } from '@/lib/types';
import { useProposalGames } from '@/hooks/use-proposal-games';
import { useGroupLibrary } from '@/hooks/use-group-library';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogSheetContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

interface ProposalGamesSectionProps {
  proposalId: string;
  groupId: string;
  proposalStatus: ProposalStatus;
  onChanged?: () => void;
}

// Proposed-game poll: upvote toggles against the derived count, plus an
// Add-game picker fed by the group library (client-side name filter — the
// endpoint takes no query params).
export function ProposalGamesSection({ proposalId, groupId, proposalStatus, onChanged }: ProposalGamesSectionProps) {
  const games = useProposalGames(proposalId, onChanged);
  const library = useGroupLibrary(groupId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return library.games;
    return library.games.filter((g) => g.name.toLowerCase().includes(q));
  }, [library.games, filter]);

  const busy = games.pendingAction !== null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">Suggested games</div>
        {proposalStatus === 'collecting' && (
          <Button type="button" variant="secondary" className="px-2 py-1 text-xs" disabled={busy} onClick={() => setPickerOpen(true)}>
            Add game
          </Button>
        )}
      </div>

      {games.loading && <p className="mt-2 text-text-muted">Loading games…</p>}
      {games.error && <p className="mt-2 text-accent">{games.error}</p>}
      {!games.loading && !games.error && games.rows.length === 0 && (
        <p className="mt-2 text-text-muted">No games suggested yet.</p>
      )}

      <ul className="mt-2 flex flex-col gap-1">
        {games.rows.map(({ proposalGameId, game, voteCount, votedByMe }) => (
          <li key={proposalGameId} className="flex items-center gap-2">
            {proposalStatus === 'collecting' ? (
              <button
                type="button"
                aria-label={votedByMe ? 'Remove your vote' : 'Vote for this game'}
                className={`text-lg leading-none ${votedByMe ? 'text-accent' : 'text-text-muted'}`}
                disabled={busy}
                onClick={() => void (votedByMe ? games.unvote(proposalGameId) : games.vote(proposalGameId))}
              >
                ▲
              </button>
            ) : null}
            <span>{game.name}</span>
            <Badge>
              {voteCount} vote{voteCount === 1 ? '' : 's'}
            </Badge>
          </li>
        ))}
      </ul>

      {games.actionError && <p className="mt-2 text-accent">{games.actionError}</p>}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogSheetContent aria-describedby={undefined}>
          <DialogTitle>Pick a game</DialogTitle>
          <DialogClose className="mb-2 mt-1 block text-sm text-text-muted">Close ✕</DialogClose>

          <input
            type="search"
            placeholder="Filter by name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-2 w-full rounded-sm border border-border bg-surface px-2 py-1 text-sm"
          />

          {library.loading && <p className="text-sm text-text-muted">Loading library…</p>}
          {library.error && <p className="text-sm text-accent">{library.error}</p>}
          {!library.loading && !library.error && filtered.length === 0 && (
            <p className="text-sm text-text-muted">Nothing matches — the library comes from members&apos; imported BGG collections.</p>
          )}

          <ul className="flex flex-col gap-1">
            {filtered.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="block w-full rounded-sm bg-surface px-2 py-1 text-left text-sm hover:bg-surface-raised"
                  disabled={busy}
                  onClick={() => {
                    void games.proposeGame(g.id);
                    setPickerOpen(false);
                    setFilter('');
                  }}
                >
                  {g.name}
                  <span className="ml-2 text-xs text-text-muted">
                    {g.minPlayers}–{g.maxPlayers} players
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogSheetContent>
      </Dialog>
    </div>
  );
}
