import type { GameCardGame } from '@/lib/types';

function ratingColor(rating: number): string {
  const colors = ['#d41118', '#f05d61', '#df8297', '#c52d70', '#c27dde', '#8d5ed0', '#489bd5', '#39b96b', '#11965f', '#006b46'];
  const bounded = Math.max(1, Math.min(10, rating));
  const lower = Math.floor(bounded);
  const upper = Math.ceil(bounded);
  if (lower === upper) return colors[lower - 1];
  const amount = bounded - lower;
  const from = colors[lower - 1].match(/\w\w/g)!.map((value) => Number.parseInt(value, 16));
  const to = colors[upper - 1].match(/\w\w/g)!.map((value) => Number.parseInt(value, 16));
  return `rgb(${from.map((value, index) => Math.round(value + (to[index] - value) * amount)).join(', ')})`;
}

export function GameArtwork({ game, className = 'aspect-[4/3] w-full', alt = '', preferFullImage = false, showRating = true }: { game: GameCardGame; className?: string; alt?: string; preferFullImage?: boolean; showRating?: boolean }) {
  const image = preferFullImage ? game.image || game.thumbnail : game.thumbnail || game.image;
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-sm bg-surface ${className}`}>
      {image && (
        // BGG image hosts are external and vary at runtime.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
      )}
      {showRating && game.rating > 0 && <span aria-label={`BGG rating ${game.rating.toFixed(1)}`} className="absolute left-0 top-0 flex size-7 items-center justify-center font-mono text-[0.6rem] font-bold text-white drop-shadow" style={{ backgroundColor: ratingColor(game.rating), clipPath: 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)' }}>{game.rating.toFixed(1)}</span>}
    </div>
  );
}
