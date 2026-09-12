import { Card } from '@/components/ui/card';
import { GameArtwork } from '@/components/game-artwork';
import { Badge } from '@/components/ui/badge';
import type { GameCardGame } from '@/lib/types';

export function GameCard({ game }: { game: GameCardGame }) {
  const playerRange = game.minPlayers === game.maxPlayers ? String(game.minPlayers) : `${game.minPlayers}–${game.maxPlayers}`;
  return (
    <Card className="flex flex-col">
      <GameArtwork game={game} preferFullImage />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-display text-lg">{game.name}</h3>
        <div className="flex flex-wrap gap-1">
          {game.minPlayers > 0 && <Badge aria-label={`${playerRange} players`}>👥 {playerRange}</Badge>}
          {game.playingTime > 0 && <Badge aria-label={`${game.playingTime} minutes`}>🕒 {game.playingTime}′</Badge>}
        </div>
      </div>
    </Card>
  );
}
