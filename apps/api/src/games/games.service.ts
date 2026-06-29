import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  private isStale(game: Game): boolean {
    return Date.now() - game.lastFetchedAt.getTime() > CACHE_TTL_MS;
  }
}
