import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { XMLParser } from 'fast-xml-parser';

// Shape of the data we extract from BGG and hand back to callers.
// This is what gets stored in the DB cache — one field per column.
export interface BggGame {
  bggId: number;
  name: string;
  description: string;
  thumbnail: string;
  image: string;
  minPlayers: number;
  maxPlayers: number;
  playingTime: number;
  yearPublished: number;
  rating: number;
}

@Injectable()
export class BggService {
  // Create the parser once and reuse it — XMLParser construction is not free.
  // ignoreAttributes: false → keep XML attributes (e.g. <minplayers value="2"/>)
  // attributeNamePrefix: '@_' → attributes are stored as '@_value', '@_type', etc.
  //   so they never collide with child element names.
  // isArray → always treat <name> as an array even when there's only one.
  //   Without this, a game with a single name comes back as an object; a game
  //   with alternates comes back as an array. The inconsistency would crash parseGame.
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) => tagName === 'name',
  });

  // HttpService is NestJS's wrapper around axios, provided by HttpModule.
  // Injecting it (rather than calling axios directly) makes the service testable:
  // tests can swap in a mock HttpService without any real HTTP calls.
  constructor(private readonly http: HttpService) {}

  async getGame(bggId: number): Promise<BggGame> {
    const xml = await this.fetchWithPolling(bggId);
    return this.parseGame(xml, bggId);
  }

  // Polls the BGG API until it returns 200, up to maxRetries attempts.
  // BGG returns 202 when it needs to generate the response server-side.
  private async fetchWithPolling(bggId: number, maxRetries = 5): Promise<string> {
    // stats=1 adds the ratings block to the response — without it, <ratings> is absent.
    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // HttpService.get() returns an RxJS Observable, not a Promise.
      // firstValueFrom() subscribes, waits for the first emission, then resolves.
      // responseType: 'text' prevents axios from trying to JSON.parse the XML body.
      const response = await firstValueFrom(
        this.http.get<string>(url, { responseType: 'text' }),
      );

      if (response.status === 200) return response.data;

      if (response.status === 202) {
        // BGG is generating the response. Wait 2 seconds before retrying.
        await this.sleep(2000);
        continue;
      }

      // Any other status (404, 500, etc.) is unrecoverable — stop immediately.
      throw new HttpException(`BGG API returned ${response.status}`, response.status);
    }

    // If we exhausted all retries BGG never became ready. 504 = Gateway Timeout.
    throw new HttpException('BGG API did not respond after max retries', 504);
  }

  private parseGame(xml: string, bggId: number): BggGame {
    const result = this.parser.parse(xml);

    // BGG wraps the response in <items><item>...</item></items>
    const item = result.items?.item;
    if (!item) {
      throw new HttpException(`Game ${bggId} not found on BGG`, 404);
    }

    // <name> is always an array (enforced by isArray above).
    // The primary display name has type="primary"; alternates have type="alternate".
    const primaryName = item.name.find(
      (n: Record<string, string>) => n['@_type'] === 'primary',
    );

    // Ratings live at item.statistics.ratings — only present because we passed stats=1.
    const ratings = item.statistics?.ratings;

    return {
      bggId,
      name: primaryName?.['@_value'] ?? 'Unknown',
      description: item.description ?? '',
      thumbnail: item.thumbnail ?? '',
      image: item.image ?? '',
      // BGG stores numeric values as attributes: <minplayers value="2"/>
      // They come out as strings after parsing — Number() converts them.
      minPlayers: Number(item.minplayers?.['@_value'] ?? 0),
      maxPlayers: Number(item.maxplayers?.['@_value'] ?? 0),
      playingTime: Number(item.playingtime?.['@_value'] ?? 0),
      yearPublished: Number(item.yearpublished?.['@_value'] ?? 0),
      rating: Number(ratings?.average?.['@_value'] ?? 0),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
