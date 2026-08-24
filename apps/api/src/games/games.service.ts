import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { BggService } from '../bgg/bgg.service';
import { Game } from './game.entity';

// How long a cached game entry is considered fresh.
// BGG data (name, rating, player count) changes rarely — 7 days is generous.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class GamesService {
  constructor(
    // @InjectRepository(Game) gives us TypeORM's Repository<Game> for this entity.
    // Repository is the object we use to query and write to the 'games' table.
    @InjectRepository(Game)
    private readonly games: Repository<Game>,

    private readonly bgg: BggService,
  ) {}

  // Returns a Game from the DB cache if fresh, otherwise fetches from BGG,
  // persists the result, and returns it. Callers always get a Game — they
  // never need to know whether the data came from cache or BGG.
  async findOrFetch(bggId: number): Promise<Game> {
    const cached = await this.games.findOne({ where: { bggId } });

    if (cached && !this.isStale(cached)) {
      return cached;
    }

    // Either no cache entry exists yet, or it's older than CACHE_TTL_MS.
    // Fetch fresh data from BGG and persist it.
    const bggData = await this.bgg.getGame(bggId);

    // Build the entity to save. If a row already exists (stale case) we reuse
    // its `id` so TypeORM issues an UPDATE rather than a second INSERT.
    const game = this.games.create({
      ...cached,        // carries over `id` and `createdAt` if row exists
      ...bggData,       // overwrites every BGG field with fresh values
      lastFetchedAt: new Date(),
    });

    return this.games.save(game);
  }

  // Chunk size for BGG's thing?id=1,2,3 batch endpoint. Kept well under any
  // practical URL-length or response-size limit.
  private static readonly BATCH_CHUNK_SIZE = 20;

  // Same cache-freshness rule as findOrFetch, applied to a whole list at
  // once: games already fresh in cache never touch BGG. Only the
  // stale-or-missing subset is sent to BggService.getGamesBatch, chunked so
  // a large collection import doesn't build one enormous URL.
  async findOrFetchMany(bggIds: number[]): Promise<Game[]> {
    if (bggIds.length === 0) return [];

    const uniqueIds = [...new Set(bggIds)];
    const cached = await this.games.findBy({ bggId: In(uniqueIds) });
    const cachedByBggId = new Map(cached.map((g) => [g.bggId, g]));

    const staleOrMissing = uniqueIds.filter((id) => {
      const existing = cachedByBggId.get(id);
      return !existing || this.isStale(existing);
    });

    const fresh = uniqueIds
      .filter((id) => !staleOrMissing.includes(id))
      .map((id) => cachedByBggId.get(id)!);

    if (staleOrMissing.length === 0) return fresh;

    const refreshed: Game[] = [];
    for (let i = 0; i < staleOrMissing.length; i += GamesService.BATCH_CHUNK_SIZE) {
      const chunk = staleOrMissing.slice(i, i + GamesService.BATCH_CHUNK_SIZE);
      const bggData = await this.bgg.getGamesBatch(chunk);

      for (const data of bggData) {
        const existing = cachedByBggId.get(data.bggId);
        const game = this.games.create({
          ...existing, // carries over `id` and `createdAt` if row exists
          ...data,
          lastFetchedAt: new Date(),
        });
        refreshed.push(await this.games.save(game));
      }
    }

    return [...fresh, ...refreshed];
  }

  // Plain cache read by internal Game.id — no BGG involvement, no
  // freshness check. Used to look up games already known to be owned
  // (via GameOwnership rows), where triggering a live fetch would be
  // surprising for what's meant to be a simple listing read.
  async findByIds(ids: number[]): Promise<Game[]> {
    if (ids.length === 0) return [];
    return this.games.findBy({ id: In(ids) });
  }

  private isStale(game: Game): boolean {
    return Date.now() - game.lastFetchedAt.getTime() > CACHE_TTL_MS;
  }
}
