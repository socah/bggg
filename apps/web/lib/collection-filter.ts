import type { GameCardGame } from '@/lib/types';

export function matchesCollectionFilters(game: GameCardGame, query: string, playerCount: string): boolean {
  const count = Number(playerCount);
  return game.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (!count || (game.minPlayers <= count && game.maxPlayers >= count));
}

export function bestCollectionMatch<T extends GameCardGame>(games: T[], query: string): T | undefined {
  const title = query.trim().toLocaleLowerCase();
  if (!title) return undefined;
  const score = (game: T) => {
    const name = game.name.toLocaleLowerCase();
    return name === title ? 0 : name.startsWith(title) ? 1 : 2;
  };
  return games.filter((game) => matchesCollectionFilters(game, query, ''))
    .sort((a, b) => score(a) - score(b) || a.name.length - b.name.length || a.name.localeCompare(b.name))[0];
}
