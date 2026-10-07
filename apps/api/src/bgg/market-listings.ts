import { XMLParser, XMLValidator } from 'fast-xml-parser';

export interface BggMarketListing {
  price: number;
  currency: string;
  url: string;
  condition: string;
  notes: string;
}

interface Listing {
  price?: { '@_currency'?: string; '@_value'?: string };
  link?: { '@_href'?: string };
  condition?: { '@_value'?: string };
  notes?: { '@_value'?: string } | string;
}

export function parseMarketListings(xml: string, bggId: number): BggMarketListing[] {
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid GeekMarket response');
  const parsed = new XMLParser({ ignoreAttributes: false, isArray: (tag) => tag === 'item' || tag === 'listing' }).parse(xml) as {
    items?: { item?: Array<{ '@_id': string; marketplacelistings?: { listing?: Listing[] } }> };
  };
  const item = parsed.items?.item?.find((entry) => Number(entry['@_id']) === bggId);
  if (!item) throw new Error('GeekMarket did not return the requested game');
  return (item.marketplacelistings?.listing ?? []).flatMap((listing) => {
    const price = Number(listing.price?.['@_value']);
    const url = listing.link?.['@_href'] ?? '';
    if (!Number.isFinite(price) || price <= 0 || !/^https:\/\/(www\.)?boardgamegeek\.com\//i.test(url)) return [];
    return [{ price, currency: listing.price?.['@_currency'] ?? '', url,
      condition: listing.condition?.['@_value'] ?? '',
      notes: typeof listing.notes === 'string' ? listing.notes : listing.notes?.['@_value'] ?? '' }];
  });
}
