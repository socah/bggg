import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { GameCardGame } from '@/lib/types';

export function GameCard({ game }: { game: GameCardGame }) {
  return (
    <Card className="flex flex-col">
      {(game.image || game.thumbnail) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={game.image || game.thumbnail || undefined} alt="" className="aspect-[4/3] w-full object-cover" />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-lg">{game.name}</h3>
        <div className="flex flex-wrap gap-2">
          {game.yearPublished > 0 && <Badge>{game.yearPublished}</Badge>}
          {game.rating > 0 && <Badge>{game.rating.toFixed(1)} BGG</Badge>}
          {game.minPlayers > 0 && <Badge>{game.minPlayers}–{game.maxPlayers} players</Badge>}
        </div>
        {game.playingTime > 0 && <p className="mt-auto pt-2 text-sm text-text-muted">{game.playingTime} min</p>}
      </div>
    </Card>
  );
}
