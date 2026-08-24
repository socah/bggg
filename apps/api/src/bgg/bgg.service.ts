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

interface BggXmlNameNode {
  '@_type'?: string;
  '@_value'?: string;
}

interface BggXmlValueNode {
  '@_value'?: string;
}

interface BggXmlItem {
  '@_id'?: string;
  '@_objectid'?: string;
  name?: BggXmlNameNode[];
  description?: string;
  thumbnail?: string;
  image?: string;
  minplayers?: BggXmlValueNode;
  maxplayers?: BggXmlValueNode;
  playingtime?: BggXmlValueNode;
  yearpublished?: BggXmlValueNode;
  statistics?: {
    ratings?: {
      average?: BggXmlValueNode;
    };
  };
}

interface BggXmlParsed {
  user?: {
    '@_id'?: string;
    '@_name'?: string;
  };
  items?: {
    item?: BggXmlItem | BggXmlItem[];
  };
  errors?: {
    error?: {
      message?: string;
    };
  };
}

type CollectionNameNode = string | { '#text'?: string } | BggXmlNameNode;

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
    // stats=1 adds the ratings block to the response — without it, <ratings> is absent.
    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggId}&stats=1`;
    const xml = await this.fetchWithPolling(url);
    return this.parseGame(xml, bggId);
  }

  // Fetches many games in one call via BGG's comma-separated id support on
  // the `thing` endpoint — avoids one HTTP round trip (plus its own 202
  // polling) per game when hydrating a whole imported collection.
  async getGamesBatch(bggIds: number[]): Promise<BggGame[]> {
    if (bggIds.length === 0) return [];

    const url = `https://boardgamegeek.com/xmlapi2/thing?id=${bggIds.join(',')}&stats=1`;
    const xml = await this.fetchWithPolling(url);
    const result = this.parser.parse(xml) as BggXmlParsed;

    return this.normalizeItems(result).map((item) => this.mapItemToGame(item));
  }

  // Confirms a BGG username exists. This endpoint is synchronous — BGG never
  // returns 202 for it — so no polling loop is needed. Used only to verify a
  // username before saving an account link; it can't prove ownership, since
  // BGG has no auth mechanism for third parties to check that against.
  async getUser(username: string): Promise<{ username: string }> {
    const url = `https://boardgamegeek.com/xmlapi2/user?name=${encodeURIComponent(username)}`;
    const response = await firstValueFrom(
      this.http.get<string>(url, { responseType: 'text' }),
    );

    if (response.status !== 200) {
      throw new HttpException(`BGG API returned ${response.status}`, response.status);
    }

    const result = this.parser.parse(response.data) as BggXmlParsed;
    const user = result.user;

    // BGG responds 200 with an empty <user/> (no id attribute) for a
    // username that doesn't exist, rather than a 404.
    if (!user || user['@_id'] === undefined || user['@_name'] === undefined) {
      throw new HttpException(`BGG user '${username}' not found`, 404);
    }

    return { username: user['@_name'] };
  }

  // Fetches the games a user has marked "own" on BGG. Returns just enough to
  // know which games to hydrate/own — full stats come from getGamesBatch.
  async getCollection(username: string): Promise<{ bggId: number; name: string }[]> {
    const url = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&own=1`;
    const xml = await this.fetchWithPolling(url);
    const result = this.parser.parse(xml) as BggXmlParsed;

    // BGG answers a renamed/deleted username with HTTP 200 and an
    // <errors><error><message>...</message></error></errors> body rather than
    // a 404. Without this check that body parses to no <items> at all, which
    // normalizeItems would flatten to [] — indistinguishable from a genuinely
    // empty collection (<items totalitems="0"/>), and importCollection would
    // read it as "owns nothing now" and delete every ownership row the user
    // has. The two XML shapes are different, so tell them apart here.
    if (result.errors || !result.items) {
      const message = result.errors?.error?.message ?? 'unknown error';
      throw new HttpException(`BGG collection request failed: ${message}`, 502);
    }

    return this.normalizeItems(result).map((item) => ({
      bggId: Number(item['@_objectid']),
      name: this.textOf(item.name),
    }));
  }

  // Polls the given URL until BGG returns 200, up to maxRetries attempts.
  // BGG returns 202 when it needs to generate the response server-side —
  // shared by the `thing` and `collection` endpoints (not `user`, which is
  // synchronous). Takes the full URL rather than building it internally, so
  // getGame/getGamesBatch/getCollection can each supply their own endpoint
  // and query string.
  private async fetchWithPolling(url: string, maxRetries = 5): Promise<string> {
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
    const result = this.parser.parse(xml) as BggXmlParsed;

    // BGG wraps the response in <items><item>...</item></items>
    const item = result.items?.item;
    if (!item) {
      throw new HttpException(`Game ${bggId} not found on BGG`, 404);
    }
    const gameItem = Array.isArray(item) ? item[0] : item;
    if (!gameItem) {
      throw new HttpException(`Game ${bggId} not found on BGG`, 404);
    }
    return this.mapItemToGame(gameItem);
  }

  // Shared by parseGame (single item) and getGamesBatch (many items) — both
  // ultimately hand this one parsed <item> object from fast-xml-parser.
  private mapItemToGame(item: BggXmlItem): BggGame {
    // <name> is always an array (enforced by isArray above).
    // The primary display name has type="primary"; alternates have type="alternate".
    // `?? []` guards against a malformed BGG item with no <name> at all —
    // one bad entry in a batch would otherwise TypeError and abort the whole
    // request; it now just falls through to the 'Unknown' default below.
    const primaryName = (item.name ?? []).find((n) => n['@_type'] === 'primary');

    // Ratings live at item.statistics.ratings — only present because we passed stats=1.
    const ratings = item.statistics?.ratings;

    return {
      bggId: Number(item['@_id']),
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

  // fast-xml-parser returns a bare object (not an array) for items.item when
  // the response has exactly one <item> — the same array-vs-object ambiguity
  // <name> already needed isArray for. <item> isn't configured with isArray
  // because that would break parseGame's single-item shape (item.name...);
  // normalizing after the fact here keeps both call shapes working.
  private normalizeItems(parsed: BggXmlParsed): BggXmlItem[] {
    const raw = parsed.items?.item;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
  }

  // <name> elements in the collection endpoint's response sometimes carry
  // attributes (e.g. sortindex) alongside their text content — when they do,
  // fast-xml-parser returns { '@_sortindex': ..., '#text': 'Gloomhaven' }
  // instead of a plain string. Because isArray forces <name> to always be an
  // array (even with one element), we extract the first element when needed.
  private textOf(node: CollectionNameNode | CollectionNameNode[] | undefined): string {
    if (Array.isArray(node)) {
      node = node[0];
    }
    if (typeof node === 'string') {
      return node;
    }
    if (!node) {
      return 'Unknown';
    }
    if ('#text' in node && typeof node['#text'] === 'string') {
      return node['#text'];
    }
    if ('@_value' in node && typeof node['@_value'] === 'string') {
      return node['@_value'];
    }
    return 'Unknown';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
