import { Injectable, BadRequestException, HttpException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BggService } from '../bgg/bgg.service';
import { GamesService } from '../games/games.service';
import { Game } from '../games/game.entity';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';

export interface ImportSummary {
  added: number;
  removed: number;
  total: number;
}

@Injectable()
export class CollectionsService {
  constructor(
    @InjectRepository(BggAccount)
    private readonly accounts: Repository<BggAccount>,
    @InjectRepository(GameOwnership)
    private readonly ownership: Repository<GameOwnership>,
    private readonly bgg: BggService,
    private readonly games: GamesService,
  ) {}

  async getAccount(userId: string): Promise<BggAccount | null> {
    return this.accounts.findOneBy({ userId });
  }

  // Verifies the username exists on BGG before saving — this can't prove
  // ownership (BGG has no such mechanism for third parties), only that the
  // username isn't a typo pointing nowhere.
  async linkAccount(userId: string, bggUsername: string): Promise<BggAccount> {
    // Store BGG's canonical spelling, not the raw client input — BGG matches
    // usernames case-insensitively, so 'ALDIE' and 'aldie' both resolve, and
    // every later collection call reads this stored value back.
    const { username } = await this.bgg.getUser(bggUsername);

    const existing = await this.accounts.findOneBy({ userId });
    const account = this.accounts.create({
      ...existing, // carries over `id` if a link already exists, so this is an UPDATE
      userId,
      bggUsername: username,
      linkedAt: new Date(),
    });

    return this.accounts.save(account);
  }

  // Ownership rows are deliberately left untouched — they represent
  // real-world ownership recorded by a past import, not BGG-link state.
  async unlinkAccount(userId: string): Promise<void> {
    await this.accounts.delete({ userId });
  }

  async getOwnedGames(userId: string): Promise<Game[]> {
    const rows = await this.ownership.findBy({ userId });
    if (rows.length === 0) return [];

    return this.games.findByIds(rows.map((row) => row.gameId));
  }

  async importCollection(userId: string): Promise<ImportSummary> {
    const account = await this.accounts.findOneBy({ userId });
    if (!account) {
      throw new BadRequestException('No BGG account linked');
    }

    const collection = await this.bgg.getCollection(account.bggUsername);
    const bggIds = collection.map((item) => item.bggId);

    // Hydrates/refreshes the shared catalogue so every currently-owned game
    // has a Game row to point at before ownership rows are touched.
    const hydratedGames = await this.games.findOrFetchMany(bggIds);

    // BGG can silently omit ids it doesn't recognise from a multi-id `thing`
    // response, and findOrFetchMany drops those rather than throwing. Syncing
    // from that partial result would read the dropped games as "no longer
    // owned" and delete their ownership rows, even though the collection
    // endpoint just said the user still owns them. Refuse the whole sync —
    // this runs before the diff, so nothing is added or removed either.
    if (hydratedGames.length < new Set(bggIds).size) {
      throw new HttpException(
        'Failed to hydrate the full collection from BGG; refusing to sync ownership from a partial result',
        502,
      );
    }

    const gameIdByBggId = new Map(hydratedGames.map((g) => [g.bggId, g.id]));
    const currentGameIds = new Set(
      bggIds
        .map((id) => gameIdByBggId.get(id))
        .filter((id): id is number => id !== undefined),
    );

    const existingOwnership = await this.ownership.findBy({ userId });
    const existingGameIds = new Set(existingOwnership.map((row) => row.gameId));

    const toAdd = [...currentGameIds].filter((gameId) => !existingGameIds.has(gameId));
    const toRemove = existingOwnership.filter((row) => !currentGameIds.has(row.gameId));

    // One transaction, as the spec requires: the add and the remove are two
    // halves of a single "make ownership match BGG" operation. Issued
    // separately, a failure between them would leave the user owning the
    // union or the intersection of the two states rather than either one.
    // `.manager` is the repository's own EntityManager, so this reuses the
    // existing connection rather than needing DataSource injected. Skipped
    // entirely when there is nothing to write — a re-import of an unchanged
    // collection is the common case, and it shouldn't cost a BEGIN/COMMIT.
    if (toAdd.length > 0 || toRemove.length > 0) {
      await this.ownership.manager.transaction(async (manager) => {
        if (toAdd.length > 0) {
          await manager.save(
            toAdd.map((gameId) => manager.create(GameOwnership, { userId, gameId })),
          );
        }

        if (toRemove.length > 0) {
          await manager.delete(GameOwnership, { id: In(toRemove.map((row) => row.id)) });
        }
      });
    }

    return { added: toAdd.length, removed: toRemove.length, total: currentGameIds.size };
  }
}
