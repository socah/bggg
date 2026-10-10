import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { BggService } from '../bgg/bgg.service';
import { PriceOffer } from './price-analysis';
import { Attribution, parseRetailPrices } from './retail-prices';
import { priceOverview, PriceHistoryRow, PriceSourceName, PriceSourceRow } from './price-overview';
import { collectionStats } from './collection-analysis';

type Source = PriceSourceName;
type SourceRow = PriceSourceRow;
type HistoryRow = PriceHistoryRow;

function byGame<T extends { game_id: number }>(rows: T[]) {
  const result = new Map<number, T[]>();
  for (const row of rows) {
    const entries = result.get(row.game_id) ?? [];
    entries.push(row);
    result.set(row.game_id, entries);
  }
  return result;
}

@Injectable()
export class PricesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PricesService.name);
  private timer?: ReturnType<typeof setInterval>;
  private collecting = false;
  private stopping = false;

  constructor(private readonly db: DataSource, private readonly http: HttpService, private readonly bgg: BggService) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void this.collectDaily(); }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async game(gameId: number): Promise<{ id: number; bgg_id: number }> {
    const rows = await this.db.query<Array<{ id: number; bgg_id: number }>>('SELECT id, bgg_id FROM games WHERE id = $1', [gameId]);
    if (!rows[0]) throw new NotFoundException('Game not found');
    return rows[0];
  }

  async overview(gameId: number) {
    const game = await this.game(gameId);
    // Serialize the two upstream calls, including when the collector is running.
    for (const source of ['retail', 'market'] as const) await this.refresh(game.id, game.bgg_id, source);
    return this.cachedOverview(gameId);
  }

  private async cachedOverview(gameId: number) {
    const sources = await this.db.query<SourceRow[]>('SELECT * FROM game_price_sources WHERE game_id = $1', [gameId]);
    const history = await this.db.query<HistoryRow[]>(`SELECT source, day::text, offers FROM game_price_history
      WHERE game_id = $1 AND day >= CURRENT_DATE - 365 ORDER BY day`, [gameId]);
    const exclusions = await this.db.query<Array<{ url: string }>>('SELECT url FROM game_market_exclusions WHERE game_id = $1', [gameId]);
    return priceOverview(sources, history, new Set(exclusions.map((row) => row.url)));
  }

  async excludeMarketListing(gameId: number, url: string) {
    await this.game(gameId);
    const known = await this.db.query<Array<{ found: number }>>(`SELECT 1 AS found FROM (
      SELECT offers FROM game_price_sources WHERE game_id = $1 AND source = 'market'
      UNION ALL SELECT offers FROM game_price_history WHERE game_id = $1 AND source = 'market'
      ) observations WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(offers) offer WHERE offer->>'url' = $2
      ) LIMIT 1`, [gameId, url]);
    if (!known.length) throw new BadRequestException('This listing is not a known marketplace offer for this game');
    await this.db.query(`INSERT INTO game_market_exclusions (game_id, url) VALUES ($1, $2)
      ON CONFLICT (game_id, url) DO NOTHING`, [gameId, url]);
    // Recompute from cached offers immediately without bypassing provider limits.
    return this.cachedOverview(gameId);
  }

  async collectionStats(userId: string) {
    const games = await this.db.query<Array<{ id: number; name: string; added_at: string; date_acquired: string | null; amount_paid: string | null }>>(`
      SELECT g.id, g.name, o.added_at::text, d.date_acquired::text, d.amount_paid
      FROM game_ownership o JOIN games g ON g.id = o.game_id
      LEFT JOIN game_private_details d ON d.game_id = o.game_id AND d.user_id = o.user_id
      WHERE o.user_id = $1 ORDER BY g.name`, [userId]);
    if (!games.length) return collectionStats([]);
    const gameIds = games.map((game) => game.id);
    // Bulk-read tracked prices; the daily collector hydrates missing games in the
    // background rather than making hundreds of upstream calls on a profile visit.
    const [sources, history, exclusions] = await Promise.all([
      this.db.query<Array<SourceRow & { game_id: number }>>('SELECT * FROM game_price_sources WHERE game_id = ANY($1::int[])', [gameIds]),
      this.db.query<Array<HistoryRow & { game_id: number }>>(`SELECT game_id, source, day::text, offers FROM game_price_history
        WHERE game_id = ANY($1::int[]) AND day >= CURRENT_DATE - 365 ORDER BY day`, [gameIds]),
      this.db.query<Array<{ game_id: number; url: string }>>('SELECT game_id, url FROM game_market_exclusions WHERE game_id = ANY($1::int[])', [gameIds]),
    ]);
    const sourceByGame = byGame(sources);
    const historyByGame = byGame(history);
    const exclusionsByGame = byGame(exclusions);
    return collectionStats(games.map((game) => {
      const prices = priceOverview(sourceByGame.get(game.id) ?? [], historyByGame.get(game.id) ?? [],
        new Set((exclusionsByGame.get(game.id) ?? []).map((row) => row.url)));
      const marketPrice = prices.market.cheapest?.price ?? null;
      const retailPrice = prices.retail.cheapest?.price ?? null;
      const useRetail = retailPrice !== null && (marketPrice === null || marketPrice > retailPrice);
      return { id: game.id, name: game.name, addedAt: game.added_at, dateAcquired: game.date_acquired,
        amountPaid: game.amount_paid === null ? null : Number(game.amount_paid), marketPrice, retailPrice,
        stale: useRetail ? prices.retail.stale : prices.market.stale };
    }));
  }

  private async refresh(gameId: number, bggId: number, source: Source) {
    await this.db.transaction(async (manager) => {
      // Cross-process lock + persisted attempt time guarantees the provider's
      // one-hour cache requirement, including concurrent users/API replicas.
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [source === 'retail' ? 71001 : 71002, gameId]);
      const rows = await manager.query<SourceRow[]>('SELECT * FROM game_price_sources WHERE game_id = $1 AND source = $2', [gameId, source]);
      if (rows[0] && Date.now() - rows[0].attempted_at.getTime() < 3_600_000) return;
      let result: { offers: PriceOffer[]; attribution: Attribution | null };
      try {
        result = await this.fetchSource(bggId, source);
      } catch (error) {
        this.logger.warn(`Price refresh failed for game ${gameId} (${source}): ${error instanceof Error ? error.message : 'upstream failure'}`);
        await manager.query(`INSERT INTO game_price_sources (game_id, source, attempted_at, error)
          VALUES ($1, $2, $3, $4) ON CONFLICT (game_id, source) DO UPDATE
          SET attempted_at = EXCLUDED.attempted_at, error = EXCLUDED.error`,
        [gameId, source, new Date(), source === 'retail' ? 'Retail prices are temporarily unavailable.' : 'GeekMarket prices are temporarily unavailable.']);
        return;
      }
      const now = new Date();
      await manager.query(`INSERT INTO game_price_sources (game_id, source, attempted_at, fetched_at, offers, attribution)
        VALUES ($1, $2, $3, $3, $4::jsonb, $5::jsonb) ON CONFLICT (game_id, source) DO UPDATE
        SET attempted_at = EXCLUDED.attempted_at, fetched_at = EXCLUDED.fetched_at,
        offers = EXCLUDED.offers, attribution = EXCLUDED.attribution, error = NULL`,
      [gameId, source, now, JSON.stringify(result.offers), JSON.stringify(result.attribution)]);
      // Keep the latest successful observation per UTC day, including sold-out
      // days (empty offers). Failures never create artificial zero-price points.
      await manager.query(`INSERT INTO game_price_history (game_id, source, day, observed_at, offers)
        VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (game_id, source, day) DO UPDATE
        SET observed_at = EXCLUDED.observed_at, offers = EXCLUDED.offers`,
      [gameId, source, now.toISOString().slice(0, 10), now, JSON.stringify(result.offers)]);
    });
  }

  private async fetchSource(bggId: number, source: Source): Promise<{ offers: PriceOffer[]; attribution: Attribution | null }> {
    if (source === 'market') {
      const listings = await this.bgg.getMarketListings(bggId);
      return { offers: listings.filter((listing) => listing.currency.toUpperCase() === 'EUR').map((listing) => ({
        price: listing.price, url: listing.url, label: listing.condition || 'GeekMarket listing', notes: listing.notes,
      })), attribution: null };
    }
    const sitename = process.env.BOARDGAMEPRICES_SITE_URL || process.env.PUBLIC_APP_URL || process.env.AUTH_URL || 'http://localhost:3000';
    const params = new URLSearchParams({ eid: String(bggId), currency: 'EUR', destination: 'GR',
      sort: 'CHEAP1', locale: 'en', sitename });
    const response = await firstValueFrom(this.http.get(`https://boardgameprices.co.uk/api/info?${params}`));
    return parseRetailPrices(response.data as Parameters<typeof parseRetailPrices>[0], bggId);
  }

  private async collectDaily() {
    if (this.collecting || this.stopping) return;
    this.collecting = true;
    try {
      // Track collections/wishlists automatically, plus any game whose panel
      // has been opened. Limit each tick to avoid overwhelming BGG.
      const games = await this.db.query<Array<{ id: number; bgg_id: number }>>(`SELECT g.id, g.bgg_id FROM games g
        WHERE (EXISTS (SELECT 1 FROM game_ownership o WHERE o.game_id = g.id)
          OR EXISTS (SELECT 1 FROM game_wishlist w WHERE w.game_id = g.id)
          OR EXISTS (SELECT 1 FROM game_price_sources p WHERE p.game_id = g.id))
        AND (SELECT COUNT(*) FROM game_price_sources p WHERE p.game_id = g.id
          AND p.attempted_at > NOW() - INTERVAL '24 hours') < 2
        ORDER BY (SELECT MIN(p.attempted_at) FROM game_price_sources p WHERE p.game_id = g.id) NULLS FIRST, g.id LIMIT 10`);
      for (const game of games) {
        if (this.stopping) break;
        for (const source of ['retail', 'market'] as const) await this.refresh(game.id, game.bgg_id, source);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      this.logger.warn(`Daily price collection failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      this.collecting = false;
    }
  }
}
