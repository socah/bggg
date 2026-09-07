'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GameDetailsSheet, LibraryGame } from '@/components/personal-collection';
import { useGroupLibrary } from '@/hooks/use-group-library';
import type { GameCardGame } from '@/lib/types';

type ViewMode = 'compact' | 'list';

export function GroupLibrary({ groupId }: { groupId: string }) {
  const { games, loading, error, reload } = useGroupLibrary(groupId);
  const [view, setView] = useState<ViewMode>('compact');
  const [selected, setSelected] = useState<GameCardGame | null>(null);

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
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">{games.length} games from group members</p>
        <div className="flex rounded-sm border-[length:var(--border-w)] border-border p-0.5" aria-label="View style">
          <button type="button" aria-pressed={view === 'compact'} onClick={() => setView('compact')} className={`rounded-sm px-3 py-1.5 text-sm font-semibold ${view === 'compact' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>Grid</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={`rounded-sm px-3 py-1.5 text-sm font-semibold ${view === 'list' ? 'bg-accent-2 text-accent-2-ink' : 'text-text-muted'}`}>List</button>
        </div>
      </div>
      <div className={view === 'compact' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6' : 'flex flex-col gap-3'}>
        {games.map((game) => <LibraryGame key={game.id} game={game} view={view} onOpen={() => setSelected(game)} />)}
      </div>
      <GameDetailsSheet game={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}
