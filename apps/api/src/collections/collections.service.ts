import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, In, Repository } from 'typeorm';
import { BggService } from '../bgg/bgg.service';
import { GamesService } from '../games/games.service';
import { Game } from '../games/game.entity';
import { Group } from '../groups/group.entity';
import { GroupMember } from '../groups/group-member.entity';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
import { PlaySession } from '../scheduling/play-session.entity';
import { PlaySessionGame } from '../scheduling/play-session-game.entity';
import { UpsertReviewDto } from './dto/upsert-review.dto';
import { BggAccount } from './bgg-account.entity';
import { GameOwnership } from './game-ownership.entity';
import { GameWishlist } from './game-wishlist.entity';
import { GameSaved } from './game-saved.entity';
import { Review } from './review.entity';
import { PersonalList } from './personal-list.entity';
import { PersonalListItem } from './personal-list-item.entity';
import { CreateListDto } from './dto/create-list.dto';
import { UpdateListDto } from './dto/update-list.dto';
import { AddListGameDto } from './dto/add-list-game.dto';
import { UpdateListGameDto } from './dto/update-list-game.dto';

export interface SyncSummary {
  added: number;
  removed: number;
  total: number;
}

export interface ImportSummary extends SyncSummary {
  wishlist: SyncSummary;
}

@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    @InjectRepository(BggAccount) private readonly accounts: Repository<BggAccount>,
    @InjectRepository(GameOwnership) private readonly ownership: Repository<GameOwnership>,
    @InjectRepository(GameWishlist) private readonly wishlist: Repository<GameWishlist>,
    @InjectRepository(GameSaved) private readonly saved: Repository<GameSaved>,
    @InjectRepository(Review) private readonly reviews: Repository<Review>,
    @InjectRepository(PersonalList) private readonly lists: Repository<PersonalList>,
    @InjectRepository(PersonalListItem) private readonly listItems: Repository<PersonalListItem>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(PlaySession) private readonly sessions: Repository<PlaySession>,
    @InjectRepository(PlaySessionGame) private readonly sessionGames: Repository<PlaySessionGame>,
    private readonly bgg: BggService,
    private readonly games: GamesService,
    private readonly keycloak: KeycloakAdminClient,
  ) {}

  getAccount(userId: string): Promise<BggAccount | null> {
    return this.accounts.findOneBy({ userId });
  }

  async linkAccount(userId: string, bggUsername: string): Promise<BggAccount> {
    const { username } = await this.bgg.getUser(bggUsername);
    const existing = await this.accounts.findOneBy({ userId });
    return this.accounts.save(this.accounts.create({
      ...existing,
      userId,
      bggUsername: username,
      linkedAt: new Date(),
    }));
  }

  async unlinkAccount(userId: string): Promise<void> {
    await this.accounts.delete({ userId });
  }

  async getOwnedGames(userId: string) {
    return this.getGamesForRows(await this.ownership.findBy({ userId }));
  }

  async getWishlistGames(userId: string) {
    return this.getGamesForRows(await this.wishlist.findBy({ userId }));
  }

  async getSavedGames(userId: string) {
    return this.getGamesForRows(await this.saved.findBy({ userId }));
  }

  getReviews(userId: string): Promise<Review[]> {
    return this.reviews.findBy({ userId });
  }

  async getLibrarySnapshot(userId: string) {
    const [collection, wishlist, saved, lists, reviews] = await Promise.all([
      this.getOwnedGames(userId),
      this.getWishlistGames(userId),
      this.getSavedGames(userId),
      this.getLists(userId),
      this.getReviews(userId),
    ]);
    return { collection, wishlist, saved, lists, reviews };
  }

  async searchGames(query: string) {
    const normalized = query.trim();
    if (normalized.length < 2) throw new BadRequestException('Search must be at least 2 characters');
    const results = await this.bgg.searchGames(normalized);
    let games: Game[] = [];
    try {
      games = await this.games.findCachedByBggIds(results.map((result) => result.bggId));
    } catch (error) {
      this.logger.warn({ msg: 'bgg_search_thumbnail_enrichment_failed', error });
    }
    const gameByBggId = new Map(games.map((game) => [game.bggId, game]));
    return results.map((result) => ({
      ...result,
      thumbnail: gameByBggId.get(result.bggId)?.thumbnail ?? '',
    }));
  }

  async addOwnedGame(userId: string, bggId: number): Promise<Game> {
    const game = await this.games.findOrFetch(bggId);
    const existing = await this.ownership.findOneBy({ userId, gameId: game.id });
    if (!existing) {
      await this.ownership.save(this.ownership.create({ userId, gameId: game.id, source: 'manual' }));
    }
    await this.wishlist.delete({ userId, gameId: game.id });
    return game;
  }

  async addWishlistGame(userId: string, bggId: number): Promise<Game> {
    const game = await this.games.findOrFetch(bggId);
    const existing = await this.wishlist.findOneBy({ userId, gameId: game.id });
    if (!existing) {
      await this.wishlist.save(this.wishlist.create({
        userId,
        gameId: game.id,
        source: 'manual',
        wishlistPriority: 3,
      }));
    }
    return game;
  }

  async addSavedGame(userId: string, bggId: number): Promise<Game> {
    const game = await this.games.findOrFetch(bggId);
    const existing = await this.saved.findOneBy({ userId, gameId: game.id });
    if (!existing) {
      await this.saved.save(this.saved.create({ userId, gameId: game.id, source: 'manual' }));
    }
    return game;
  }

  async removeOwnedGame(userId: string, gameId: number): Promise<void> {
    const row = await this.ownership.findOneBy({ userId, gameId });
    if (!row) throw new NotFoundException('Collection game not found');
    if (row.source === 'bgg') {
      throw new BadRequestException('Remove this game on BoardGameGeek, then sync your collection.');
    }
    await this.ownership.delete({ userId, gameId });
  }

  async removeWishlistGame(userId: string, gameId: number): Promise<void> {
    const row = await this.wishlist.findOneBy({ userId, gameId });
    if (!row) throw new NotFoundException('Wishlist game not found');
    if (row.source === 'bgg') {
      throw new BadRequestException('Remove this game from your BoardGameGeek wishlist, then sync.');
    }
    await this.wishlist.delete({ userId, gameId });
  }

  async removeSavedGame(userId: string, gameId: number): Promise<void> {
    await this.saved.delete({ userId, gameId });
  }

  async updateWishlistPriority(userId: string, gameId: number, wishlistPriority: number) {
    const row = await this.wishlist.findOneBy({ userId, gameId });
    if (!row) throw new NotFoundException('Wishlist game not found');
    if (row.source === 'bgg') {
      throw new BadRequestException('Change wishlist priority on BoardGameGeek, then sync.');
    }
    row.wishlistPriority = wishlistPriority;
    await this.wishlist.save(row);
    const [result] = await this.getGamesForRows([row]);
    return result;
  }

  async importCollection(userId: string): Promise<ImportSummary> {
    const account = await this.accounts.findOneBy({ userId });
    if (!account) throw new BadRequestException('No BGG account linked');

    const [ownedCollection, wishlistCollection] = await Promise.all([
      this.bgg.getCollection(account.bggUsername),
      this.bgg.getWishlist(account.bggUsername),
    ]);
    const allBggIds = [...new Set([
      ...ownedCollection.map((item) => item.bggId),
      ...wishlistCollection.map((item) => item.bggId),
    ])];
    const hydratedGames = await this.games.findOrFetchMany(allBggIds);
    if (hydratedGames.length < allBggIds.length) {
      throw new HttpException(
        'Failed to hydrate the full collection from BGG; refusing to sync from a partial result',
        502,
      );
    }

    const gameIdByBggId = new Map(hydratedGames.map((game) => [game.bggId, game.id]));
    const ownedIds = new Set(ownedCollection.map((item) => gameIdByBggId.get(item.bggId)!));
    const wishlistPriorities = new Map<number, number>();
    for (const item of wishlistCollection) {
      const gameId = gameIdByBggId.get(item.bggId)!;
      if (!ownedIds.has(gameId)) wishlistPriorities.set(gameId, item.wishlistPriority ?? 3);
    }
    const existingOwned = await this.ownership.findBy({ userId });
    const existingWishlist = await this.wishlist.findBy({ userId });
    const ownedSummary = await this.syncBggRows(GameOwnership, userId, ownedIds, existingOwned);
    const wishlistSummary = await this.syncWishlistRows(
      userId,
      wishlistPriorities,
      existingWishlist,
    );
    await this.syncBggReviews(
      userId,
      ownedCollection,
      gameIdByBggId,
      existingOwned.filter((row) => row.source === 'bgg').map((row) => row.gameId),
    );

    // A BGG wishlist entry promoted to owned cannot remain in both lists.
    if (ownedIds.size > 0) await this.wishlist.delete({ userId, gameId: In([...ownedIds]) });
    return { ...ownedSummary, wishlist: wishlistSummary };
  }

  async getLists(userId: string) {
    const lists = await this.lists.find({ where: { userId }, order: { createdAt: 'ASC' } });
    if (lists.length === 0) return [];
    const items = await this.listItems.findBy({ listId: In(lists.map((list) => list.id)) });
    const games = await this.games.findByIds([...new Set(items.map((item) => item.gameId))]);
    const gameById = new Map(games.map((game) => [game.id, game]));
    return lists.map((list) => ({
      ...list,
      items: items
        .filter((item) => item.listId === list.id)
        .sort((a, b) => a.position - b.position)
        .map((item) => ({ ...gameById.get(item.gameId)!, tier: item.tier, position: item.position })),
    }));
  }

  async createList(userId: string, dto: CreateListDto): Promise<PersonalList> {
    const tiers = dto.tiers ?? ['S', 'A', 'B', 'C', 'D'];
    if (dto.type === 'tier' && tiers.length === 0) {
      throw new BadRequestException('Tier lists must contain at least one tier');
    }
    return this.lists.save(this.lists.create({ ...dto, userId, tiers }));
  }

  async updateList(userId: string, listId: string, dto: UpdateListDto): Promise<PersonalList> {
    const list = await this.requireList(userId, listId);
    if (dto.name === undefined && dto.tiers === undefined) {
      throw new BadRequestException('Provide a name or tiers to update');
    }
    if (dto.tiers !== undefined) {
      if (list.type !== 'tier') throw new BadRequestException('Custom lists do not use tiers');
      if (dto.tiers.length === 0) throw new BadRequestException('Tier lists must contain at least one tier');
      const items = await this.listItems.findBy({ listId });
      const displaced = items.filter((item) => item.tier !== null && !dto.tiers!.includes(item.tier));
      if (displaced.length > 0) {
        const unranked = items.filter((item) => item.tier === null).sort((a, b) => a.position - b.position);
        displaced.sort((a, b) => a.position - b.position);
        await this.listItems.save([
          ...unranked.map((item, position) => ({ ...item, position })),
          ...displaced.map((item, index) => ({ ...item, tier: null, position: unranked.length + index })),
        ]);
      }
    }
    Object.assign(list, dto);
    return this.lists.save(list);
  }

  async removeList(userId: string, listId: string): Promise<void> {
    const list = await this.requireList(userId, listId);
    await this.lists.remove(list);
  }

  async addListGame(userId: string, listId: string, dto: AddListGameDto) {
    const list = await this.requireList(userId, listId);
    this.assertValidTier(list, dto.tier ?? null);
    const game = await this.games.findOrFetch(dto.bggId);
    const existing = await this.listItems.findOneBy({ listId, gameId: game.id });
    if (existing) throw new BadRequestException('Game is already in this list');
    const items = await this.listItems.findBy({ listId });
    const position = items.reduce((max, item) => Math.max(max, item.position), -1) + 1;
    const item = await this.listItems.save(this.listItems.create({
      listId,
      gameId: game.id,
      tier: dto.tier ?? null,
      position,
    }));
    return { ...game, tier: item.tier, position: item.position };
  }

  async updateListGame(
    userId: string,
    listId: string,
    gameId: number,
    dto: UpdateListGameDto,
  ) {
    const list = await this.requireList(userId, listId);
    if (dto.tier === undefined && dto.position === undefined) {
      throw new BadRequestException('Provide a tier or position to update');
    }
    if (dto.tier !== undefined) this.assertValidTier(list, dto.tier);
    const item = await this.listItems.findOneBy({ listId, gameId });
    if (!item) throw new NotFoundException('List game not found');
    const previousTier = item.tier;
    const targetTier = dto.tier === undefined ? item.tier : dto.tier;
    const items = await this.listItems.findBy({ listId });
    const targetItems = items
      .filter((candidate) => candidate.gameId !== gameId && candidate.tier === targetTier)
      .sort((a, b) => a.position - b.position);
    const requestedPosition = dto.position ?? (targetTier === previousTier ? item.position : targetItems.length);
    targetItems.splice(Math.min(requestedPosition, targetItems.length), 0, { ...item, tier: targetTier });

    const affected = targetItems.map((candidate, position) => ({ ...candidate, position }));
    if (previousTier !== targetTier) {
      affected.push(...items
        .filter((candidate) => candidate.gameId !== gameId && candidate.tier === previousTier)
        .sort((a, b) => a.position - b.position)
        .map((candidate, position) => ({ ...candidate, position })));
    }
    await this.listItems.save(affected);
    const saved = affected.find((candidate) => candidate.gameId === gameId)!;
    const [game] = await this.games.findByIds([gameId]);
    return { ...game, tier: saved.tier, position: saved.position };
  }

  async removeListGame(userId: string, listId: string, gameId: number): Promise<void> {
    await this.requireList(userId, listId);
    await this.listItems.delete({ listId, gameId });
  }

  async getGameDetails(userId: string, gameId: number) {
    const [game] = await this.games.findByIds([gameId]);
    if (!game) throw new NotFoundException('Game not found');

    const myMemberships = await this.members.findBy({ userId });
    const groupIds = myMemberships.map((membership) => membership.groupId);
    const visibleMemberships = groupIds.length
      ? await this.members.findBy({ groupId: In(groupIds) })
      : [];
    const visibleUserIds = [...new Set([userId, ...visibleMemberships.map((member) => member.userId)])];
    const reviewRows = await this.reviews.find({
      where: { gameId, userId: In(visibleUserIds) },
      order: { updatedAt: 'DESC' },
    });
    const reviewViews = await Promise.all(reviewRows.map(async (review) => {
      const person = await this.keycloak.getUser(review.userId).catch(() => ({
        username: 'unknown-member',
        displayName: 'Unknown member',
      }));
      const profileGroupId = groupIds.find((groupId) => visibleMemberships.some(
        (membership) => membership.groupId === groupId && membership.userId === review.userId,
      )) ?? null;
      return {
        ...review,
        isMine: review.userId === userId,
        username: person.username,
        displayName: person.displayName,
        profileGroupId,
      };
    }));

    const playRows = groupIds.length
      ? await this.sessionGames.findBy({ gameId })
      : [];
    const sessions = playRows.length
      ? await this.sessions.find({
          where: { id: In(playRows.map((row) => row.sessionId)), groupId: In(groupIds) },
          order: { playedAt: 'DESC' },
        })
      : [];
    const groupRows = sessions.length
      ? await this.groups.findBy({ id: In([...new Set(sessions.map((session) => session.groupId))]) })
      : [];
    const groupNameById = new Map(groupRows.map((group) => [group.id, group.name]));
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const myRoleByGroup = new Map(myMemberships.map((membership) => [membership.groupId, membership.role]));

    return {
      game,
      reviews: reviewViews,
      plays: playRows.map((play) => {
        const session = sessionById.get(play.sessionId);
        if (!session) return null;
        return {
        id: play.id,
        sessionId: session.id,
        groupId: session.groupId,
        playedAt: session.playedAt,
        notes: play.notes ?? session.notes,
        status: play.status,
        durationMinutes: play.durationMinutes,
        canEdit: play.loggedBy === userId || ['owner', 'admin'].includes(myRoleByGroup.get(session.groupId) ?? ''),
        groupName: groupNameById.get(session.groupId) ?? 'Group',
      }; }).filter((play): play is NonNullable<typeof play> => play !== null)
        .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime()),
    };
  }

  async upsertReview(userId: string, gameId: number, dto: UpsertReviewDto): Promise<Review> {
    const [game] = await this.games.findByIds([gameId]);
    if (!game) throw new NotFoundException('Game not found');
    const existing = await this.reviews.findOneBy({ userId, gameId });
    if (dto.rating == null && dto.complexityScore == null && dto.depthScore == null && !dto.body?.trim()) {
      throw new BadRequestException('A review must contain a rating, complexity, depth, or comment.');
    }
    return this.reviews.save(this.reviews.create({
      ...existing,
      userId,
      gameId,
      rating: dto.rating ?? existing?.rating ?? null,
      complexityScore: dto.complexityScore ?? null,
      depthScore: dto.depthScore ?? null,
      body: dto.body?.trim() || null,
      source: existing?.source ?? 'manual',
    }));
  }

  async removeReview(userId: string, gameId: number): Promise<void> {
    const review = await this.reviews.findOneBy({ userId, gameId });
    if (!review) throw new NotFoundException('Review not found');
    if (review.source === 'bgg') {
      throw new BadRequestException(
        'This review was imported from BGG. Remove it on BGG and sync your collection.',
      );
    }
    await this.reviews.remove(review);
  }

  private async getGamesForRows<T extends {
    gameId: number;
    source: 'manual' | 'bgg';
    addedAt: Date;
    wishlistPriority?: number;
  }>(rows: T[]) {
    if (rows.length === 0) return [];
    const games = await this.games.findByIds(rows.map((row) => row.gameId));
    const gameById = new Map(games.map((game) => [game.id, game]));
    return rows
      .map((row) => ({
        ...gameById.get(row.gameId)!,
        source: row.source,
        addedAt: row.addedAt,
        ...(row.wishlistPriority === undefined ? {} : { wishlistPriority: row.wishlistPriority }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async syncWishlistRows(
    userId: string,
    priorities: Map<number, number>,
    existingRows: GameWishlist[],
  ): Promise<SyncSummary> {
    const currentIds = new Set(priorities.keys());
    const existingIds = new Set(existingRows.map((row) => row.gameId));
    const toAdd = [...currentIds].filter((gameId) => !existingIds.has(gameId));
    const toRemove = existingRows.filter((row) => row.source === 'bgg' && !currentIds.has(row.gameId));
    const rowsByGameId = new Map(existingRows.map((row) => [row.gameId, row]));
    const currentRows = [...currentIds].map((gameId) => ({
      ...rowsByGameId.get(gameId),
      userId,
      gameId,
      source: 'bgg' as const,
      wishlistPriority: priorities.get(gameId),
    }));
    if (currentRows.length || toRemove.length) await this.ownership.manager.transaction(async (manager) => {
      if (currentRows.length) await manager.save(GameWishlist, currentRows);
      if (toRemove.length) await manager.delete(GameWishlist, { id: In(toRemove.map((row) => row.id)) });
    });
    return { added: toAdd.length, removed: toRemove.length, total: currentIds.size };
  }

  private async syncBggReviews(
    userId: string,
    collection: Array<{ bggId: number; userRating: number | null; comment: string | null }>,
    gameIdByBggId: Map<number, number>,
    previousBggOwnedIds: number[],
  ): Promise<void> {
    const currentOwnedIds = collection.map((item) => gameIdByBggId.get(item.bggId)!);
    const scope = [...new Set([...currentOwnedIds, ...previousBggOwnedIds])];
    if (scope.length === 0) return;
    const existing = await this.reviews.findBy({ userId, gameId: In(scope) });
    const existingByGameId = new Map(existing.map((review) => [review.gameId, review]));
    const withContent = new Set<number>();

    for (const item of collection) {
      const gameId = gameIdByBggId.get(item.bggId)!;
      if (item.userRating == null) continue;
      withContent.add(gameId);
      const review = existingByGameId.get(gameId);
      if (review?.source === 'manual') continue;
      await this.reviews.save(this.reviews.create({
        ...review,
        userId,
        gameId,
        rating: item.userRating,
        body: review?.body ?? null,
        complexityScore: review?.complexityScore ?? null,
        depthScore: review?.depthScore ?? null,
        source: review?.source ?? 'bgg',
      }));
    }

    const staleIds = existing
      .filter((review) => review.source === 'bgg'
        && !withContent.has(review.gameId)
        && !review.body
        && review.complexityScore == null
        && review.depthScore == null)
      .map((review) => review.id);
    if (staleIds.length) await this.reviews.delete({ id: In(staleIds) });
  }

  private async requireList(userId: string, listId: string): Promise<PersonalList> {
    const list = await this.lists.findOneBy({ id: listId, userId });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  private assertValidTier(list: PersonalList, tier: string | null): void {
    if (tier === null) return;
    if (list.type !== 'tier') throw new BadRequestException('Custom lists do not use tiers');
    if (!list.tiers.includes(tier)) throw new BadRequestException(`Invalid tier '${tier}'`);
  }

  private async syncBggRows<T extends GameOwnership | GameWishlist>(
    entity: { new(): T },
    userId: string,
    currentGameIds: Set<number>,
    existingRows: T[],
  ): Promise<SyncSummary> {
    const existingIds = new Set(existingRows.map((row) => row.gameId));
    const toAdd = [...currentGameIds].filter((gameId) => !existingIds.has(gameId));
    const toRemove = existingRows.filter(
      (row) => row.source === 'bgg' && !currentGameIds.has(row.gameId),
    );
    const rowsByGameId = new Map(existingRows.map((row) => [row.gameId, row]));
    const currentRows = [...currentGameIds].map((gameId) => ({
      ...rowsByGameId.get(gameId),
      userId,
      gameId,
      source: 'bgg' as const,
    }));
    if (currentRows.length || toRemove.length) {
      await this.ownership.manager.transaction(async (manager) => {
        if (currentRows.length) await manager.save(entity, currentRows as DeepPartial<T>[]);
        if (toRemove.length) await manager.delete(entity, { id: In(toRemove.map((row) => row.id)) });
      });
    }
    return { added: toAdd.length, removed: toRemove.length, total: currentGameIds.size };
  }
}
