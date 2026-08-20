import { Injectable, BadRequestException } from '@nestjs/common';
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
    await this.bgg.getUser(bggUsername);

    const existing = await this.accounts.findOneBy({ userId });
    const account = this.accounts.create({
      ...existing, // carries over `id` if a link already exists, so this is an UPDATE
      userId,
      bggUsername,
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

    if (toAdd.length > 0) {
      await this.ownership.save(
        toAdd.map((gameId) => this.ownership.create({ userId, gameId })),
      );
    }

    if (toRemove.length > 0) {
      await this.ownership.delete({ id: In(toRemove.map((row) => row.id)) });
    }

    return { added: toAdd.length, removed: toRemove.length, total: currentGameIds.size };
  }
}
