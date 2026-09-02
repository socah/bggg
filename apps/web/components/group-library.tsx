'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GameCard } from '@/components/game-card';
import { useGroupLibrary } from '@/hooks/use-group-library';

export function GroupLibrary({ groupId }: { groupId: string }) {
  const { games, loading, error, reload } = useGroupLibrary(groupId);

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
        This group library is empty. Games appear here when members import their BGG collections.
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {games.map((game) => <GameCard key={game.id} game={game} />)}
    </div>
  );
}
