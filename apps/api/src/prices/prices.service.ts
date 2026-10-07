import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { BggService } from '../bgg/bgg.service';
import { bargainEstimate, cheapest, filterMarketOffers, PriceHistoryPoint, PriceOffer } from './price-analysis';
import { Attribution, parseRetailPrices } from './retail-prices';

type Source = 'retail' | 'market';
interface SourceRow {
  source: Source;
  attempted_at: Date;
  fetched_at: Date | null;
  offers: PriceOffer[];
  attribution: Attribution | null;
  error: string | null;
}
interface HistoryRow { source: Source; day: string; offers: PriceOffer[] }

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
    const sources = await this.db.query<SourceRow[]>('SELECT * FROM game_price_sources WHERE game_id = $1', [gameId]);
    const history = await this.db.query<HistoryRow[]>(`SELECT source, day::text, offers FROM game_price_history
      WHERE game_id = $1 AND day >= CURRENT_DATE - 365 ORDER BY day`, [gameId]);
    const marketRows = history.filter((row) => row.source === 'market');
    const reference = marketRows.slice(-90).flatMap((row) => filterMarketOffers(row.offers).map((offer) => offer.price));
    const points = (source: Source): PriceHistoryPoint[] => history.filter((row) => row.source === source).map((row) => {
      const filtered = source === 'market' ? filterMarketOffers(row.offers, reference) : row.offers;
      return { date: row.day, price: cheapest(row.offers)?.price ?? null,
        filteredPrice: cheapest(filtered)?.price ?? null, offerCount: row.offers.length,
        excludedCount: row.offers.length - filtered.length };
    });
    const view = (source: Source) => {
      const state = sources.find((row) => row.source === source);
      const offers = state?.offers ?? [];
      const filtered = source === 'market' ? filterMarketOffers(offers, reference) : offers;
      return { cheapest: cheapest(filtered), offerCount: offers.length, excludedCount: offers.length - filtered.length,
        fetchedAt: state?.fetched_at?.toISOString() ?? null,
        stale: !state?.fetched_at || Date.now() - state.fetched_at.getTime() > 86_400_000 || Boolean(state.error),
        error: state?.error ?? null, attribution: state?.attribution ?? null, history: points(source) };
    };
    const retail = view('retail');
    const market = view('market');
    return { currency: 'EUR', destination: 'GR', retail, market, bargain: bargainEstimate(market.history) };
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
