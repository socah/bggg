'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
      {games.map((game) => (
        <Card key={game.id} className="flex flex-col">
          {game.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={game.thumbnail} alt="" className="aspect-[4/3] w-full object-cover" />
          )}
          <div className="flex flex-1 flex-col gap-2 p-4">
            <h2 className="font-display text-lg">{game.name}</h2>
            <div className="flex flex-wrap gap-2">
              {game.minPlayers > 0 && game.maxPlayers > 0 && (
                <Badge>{game.minPlayers}-{game.maxPlayers} players</Badge>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
