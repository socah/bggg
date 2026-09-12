import type { GameCardGame } from '@/lib/types';

function ratingColor(rating: number): string {
  if (rating >= 8) return '#237a57';
  if (rating >= 7) return '#4f8a3c';
  if (rating >= 6) return '#aa7b18';
  if (rating >= 5) return '#bd642d';
  return '#a94442';
}

export function GameArtwork({ game, className = 'aspect-[4/3] w-full', alt = '', preferFullImage = false }: { game: GameCardGame; className?: string; alt?: string; preferFullImage?: boolean }) {
  const image = preferFullImage ? game.image || game.thumbnail : game.thumbnail || game.image;
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-sm bg-surface ${className}`}>
      {image && (
        // BGG image hosts are external and vary at runtime.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
      )}
      {game.rating > 0 && <span aria-label={`BGG rating ${game.rating.toFixed(1)}`} className="absolute left-1 top-1 flex size-8 items-center justify-center font-mono text-[0.65rem] font-bold text-white drop-shadow" style={{ backgroundColor: ratingColor(game.rating), clipPath: 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)' }}>{game.rating.toFixed(1)}</span>}
    </div>
  );
}
