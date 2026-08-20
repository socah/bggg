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
}
